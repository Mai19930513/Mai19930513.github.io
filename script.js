/**
 * ------------------------------------------------------------------
 * 1. 核心逻辑类 (移植自 chelaile_tasker_new.js)
 * ------------------------------------------------------------------
 */

// 坐标转换工具
class EvilTransform {
    constructor() {
        this.earthR = 6378137.0;
    }
    transform(x, y) {
        var xy = x * y;
        var absX = Math.abs(x);
        var xPi = x * Math.PI;
        var yPi = y * Math.PI;
        var d =
            20.0 * Math.sin(6.0 * xPi) + 20.0 * Math.sin(2.0 * xPi);
        var lat = d;
        var lng = d;
        lat += 20.0 * Math.sin(yPi) + 40.0 * Math.sin(yPi / 3.0);
        lng += 20.0 * Math.sin(xPi) + 40.0 * Math.sin(xPi / 3.0);
        lat +=
            160.0 * Math.sin(yPi / 12.0) +
            320 * Math.sin(yPi / 30.0);
        lng +=
            150.0 * Math.sin(xPi / 12.0) +
            300.0 * Math.sin(xPi / 30.0);
        lat *= 2.0 / 3.0;
        lng *= 2.0 / 3.0;
        lat +=
            -100.0 +
            2.0 * x +
            3.0 * y +
            0.2 * y * y +
            0.1 * xy +
            0.2 * absX;
        lng +=
            300.0 +
            x +
            2.0 * y +
            0.1 * x * x +
            0.1 * xy +
            0.1 * absX;
        return { lat: lat, lng: lng };
    }
    delta(lat, lng) {
        var ee = 0.00669342162296594323;
        var d = this.transform(lng - 105.0, lat - 35.0);
        var radLat = (lat / 180.0) * Math.PI;
        var magic = Math.sin(radLat);
        magic = 1 - ee * magic * magic;
        var sqrtMagic = Math.sqrt(magic);
        d.lat =
            (d.lat * 180.0) /
            (((this.earthR * (1 - ee)) / (magic * sqrtMagic)) *
                Math.PI);
        d.lng =
            (d.lng * 180.0) /
            ((this.earthR / sqrtMagic) *
                Math.cos(radLat) *
                Math.PI);
        return d;
    }
    outOfChina(lat, lng) {
        if (lng < 72.004 || lng > 137.8347) return true;
        if (lat < 0.8293 || lat > 55.8271) return true;
        return false;
    }
    wgs2gcj(wgsLat, wgsLng) {
        if (this.outOfChina(wgsLat, wgsLng))
            return { lat: wgsLat, lng: wgsLng };
        var d = this.delta(wgsLat, wgsLng);
        return { lat: wgsLat + d.lat, lng: wgsLng + d.lng };
    }
    static create() {
        return new EvilTransform();
    }
}

// 字符串相似度
class StringSimilarityUtil {
    static compareTwoStrings(a, b) {
        a = String(a);
        b = String(b);
        if (a === b) return 1;
        if (a.length < 2 || b.length < 2) return 0;
        let firstBig = a.length > b.length ? a : b;
        let second = firstBig === a ? b : a;
        return firstBig.includes(second) ? 1 : 0; // 简化版，仅作包含匹配
    }
    static findBestMatch(target, sources) {
        let bestMatchIndex = -1,
            bestRating = 0;
        for (let i = 0; i < sources.length; i++) {
            const rating = this.compareTwoStrings(
                target,
                sources[i],
            );
            if (rating > bestRating) {
                bestRating = rating;
                bestMatchIndex = i;
            }
        }
        return { bestMatchIndex };
    }
}

// 车来了 API 封装
class CheLaile {
    constructor() {
        // const PROXY_BASE = "";
        const PROXY_BASE = "https://real-time-bus.netlify.app/proxy";

        this.citylist_url =
            PROXY_BASE +
            "/api/citylist";
        this.lineDetail =
            PROXY_BASE +
            "/api/LineDetail";
        this.queryLineUrl =
            PROXY_BASE +
            "/api/Search";
        this.key = "FF32AE65FBFD19414EAAFF6291A54B42";
        this.v = "3.11.26";
        this.src = "weixinapp_cx";
        // 注意：浏览器直接请求可能会被 Referer 策略拦截，尽量使用允许跨域的环境
        this.headers = {
            Referer:
                "https://servicewechat.com/wx71d589ea01ce3321/810/page-frame.html",
        };
        this._cityIdMap = null;
        // 静态数据缓存（存储站点、ID、线路名等）
        // Key 格式: "city-line-fx"
        this._staticCache = {};
    }

    encodeParams(obj) {
        return Object.keys(obj)
            .map(
                (k) =>
                    `${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`,
            )
            .join("&");
    }

    async _request({
        Url,
        Method = "GET",
        headers = this.headers,
    } = {}) {
        try {
            const res = await fetch(Url, {
                method: Method,
                headers: new Headers(headers),
            });
            if (!res.ok) {
                // 打印出具体的错误状态，方便调试
                console.error(
                    `Request Failed: ${Url} status: ${res.status}`,
                );
                throw new Error(`HTTP ${res.status}`);
            }
            return await res.text();
        } catch (error) {
            console.error("Fetch Error:", error);
            return null;
        }
    }

    decryptResult(encryptData) {
        if (!CryptoJS) return null;
        try {
            const keyUtf8 = CryptoJS.enc.Utf8.parse(this.key);
            let cipherText = decodeURIComponent(
                String(encryptData),
            );
            const decrypted = CryptoJS.AES.decrypt(
                cipherText,
                keyUtf8,
                {
                    mode: CryptoJS.mode.ECB,
                    padding: CryptoJS.pad.Pkcs7,
                },
            );
            return JSON.parse(
                decrypted.toString(CryptoJS.enc.Utf8),
            );
        } catch (e) {
            console.error("Decrypt error", e);
            return null;
        }
    }
    async getCities() {
        const res = await this._request({ Url: this.citylist_url });
        if (!res) return null;
        try {
            const data = JSON.parse(res);
            return data.data.allRealtimeCity;
        } catch (e) {
            return null;
        }
    }
    async getCityIdByName(cityName) {
        if (this._cityIdMap && this._cityIdMap[cityName])
            return this._cityIdMap[cityName];
        const res = await this._request({ Url: this.citylist_url });
        if (!res) return null;
        try {
            const data = JSON.parse(res);
            const list = data.data.allRealtimeCity || [];
            this._cityIdMap = {};
            list.forEach((c) => {
                this._cityIdMap[c.cityName] = String(c.cityId);
                this._cityIdMap[c.cityName.replace("市", "")] =
                    String(c.cityId);
            });
            return (
                this._cityIdMap[cityName] ||
                this._cityIdMap[cityName.replace("市", "")] ||
                null
            );
        } catch (e) {
            return null;
        }
    }

    async getLineInfoByName(cityId, lineName, fx) {
        const params = {
            s: "h5",
            wxs: "wx_app",
            sign: 1,
            v: this.v,
            cityId,
            key: lineName,
        };
        const url = `${this.queryLineUrl}?${this.encodeParams(params)}`;
        const res = await this._request({
            Url: url,
            headers: this.headers,
        });
        if (!res) return null;
        try {
            const j = JSON.parse(
                res.replace(/YGKJ##|\*\*YGKJ/g, ""),
            )?.jsonr;
            if (j?.data?.result?.lines) {
                return (
                    j.data.result.lines.find(
                        (l) =>
                            String(l.direction) === String(fx) &&
                            l.name === lineName,
                    ) || j.data.result.lines[0]
                );
            }
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async getBusInfoByLineId(cityId, lineId, targetOrder = 1) {
        const params = {
            s: "h5",
            wxs: "wx_app",
            sign: 1,
            v: this.v,
            cityId,
            lineId,
            targetOrder,
            src: this.src,
        };
        const url = `${this.lineDetail}?${this.encodeParams(params)}`;
        const res = await this._request({
            Url: url,
            Headers: this.headers,
        });
        if (!res) return null;
        try {
            const j = JSON.parse(
                res.replace(/YGKJ##|\*\*YGKJ/g, ""),
            )?.jsonr;
            if (j?.status === "00" && j.data.encryptResult) {
                return {
                    data: this.decryptResult(j.data.encryptResult),
                    status: "00",
                };
            }
            return j;
        } catch (e) {
            return null;
        }
    }

    /**
     * 核心方法：获取线路和实时数据 (带静态数据缓存)
     * @param {string} city 城市名
     * @param {string} line 线路号
     * @param {string} fx 方向 (0 或 1)
     * @param {string} stationName 关注的站名
     */
    async getTripInfo(city, line, fx, stationName) {
        const cacheKey = `${city}-${line}-${fx}`;
        let staticData = this._staticCache[cacheKey];
        if (!staticData) {
            console.log(
                `[Cache] 正在初始化静态站点数据: ${cacheKey}`,
            );
            const cityId = await this.getCityIdByName(city);
            if (!cityId)
                throw new Error("无法找到城市ID，请检查城市名");

            const lineInfoObj = await this.getLineInfoByName(
                cityId,
                line,
                fx,
            );
            if (!lineInfoObj) throw new Error("无法找到线路信息");
            const lineId = lineInfoObj.lineId;

            // 获取完整线路详情（包含站点）
            const busRes = await this.getBusInfoByLineId(
                cityId,
                lineId,
            );
            if (!busRes || busRes.status != "00")
                throw new Error("无法获取线路详情");

            const busesInfo = busRes.data;
            const stations = busesInfo.stations.map((s) => ({
                name: s.sn,
                distanceToSp: s.distanceToSp,
                metros: s.metros,
                sId: s.sId,
            }));
            // 写入缓存对象
            staticData = {
                cityId,
                lineId,
                stations,
                lineName:
                    busesInfo.line.startSn +
                    " ➡ " +
                    busesInfo.line.endSn,
                defaultTip: `${busesInfo.line.desc}(${busesInfo.line.firstTime}-${busesInfo.line.lastTime})`,
            };
            this._staticCache[cacheKey] = staticData;
        }

        // 3. 每次 Loop 共享使用的静态数据
        const { cityId, lineId, stations, lineName, defaultTip } =
            staticData;
        // 确定用户所在站点索引
        let zd = 1;
        if (stationName) {
            const names = stations.map((s) => s.name);
            const match = StringSimilarityUtil.findBestMatch(
                stationName,
                names,
            );
            if (match.bestMatchIndex !== -1)
                zd = match.bestMatchIndex + 1;
        }

        // 获取实时车辆（带站点排序）
        const realRes = await this.getBusInfoByLineId(
            cityId,
            lineId,
            zd,
        );
        if (!realRes || realRes.status != "00")
            throw new Error("无法获取实时数据");

        const realData = realRes.data;

        // 格式化车辆数据
        const arrBus = [],
            missBus = [];
        (realData.buses || []).forEach((bus) => {
            const info = {
                busId: bus.busId,
                stationName: stations[bus.order - 1]?.name,
                order: bus.order,
                distanceToSc: bus.distanceToSc,
                recommTip: bus.travels?.[0]?.recommTip || "",
                nextstopname: stations[bus.order - 1]?.name, // 近似处理
                nextstoporder: bus.order,
            };
            if (info.recommTip) arrBus.push(info);
            else missBus.push(info);
        });
        arrBus.sort((a, b) => {
            const [ah, am] = a.recommTip.split(":").map(Number);
            const [bh, bm] = b.recommTip.split(":").map(Number);
            return ah * 60 + am - (bh * 60 + bm);
        });
        missBus.sort((a, b) => {
            return a.next_stop_order - b.next_stop_order;
        });
        return {
            lineName:
                realData.line.startSn + " ⇀ " + realData.line.endSn,
            lineCode: line,
            stationindex: zd,
            stationname: stations[zd - 1].name,
            stations: stations,
            arrBus,
            missBus,
            tip:
                realData.tip?.desc ||
                `${realData?.line?.desc}(${realData?.line?.firstTime}-${realData?.line?.lastTime})`,
            updatetime: new Date().toLocaleTimeString(),
        };
    }
}

/**
 * ------------------------------------------------------------------
 * 2. 可视化渲染逻辑
 * ------------------------------------------------------------------
 */
// SVG 图标
const busIcon = `<svg width="40" height="40" viewBox="0 0 972 855" xmlns="http://www.w3.org/2000/svg" t="1770220015030" class="icon" version="1.1" p-id="19005">
<path d="m468.50391,854.80942c-2.53846,0 -4.88164,-1.21592 -6.63904,-3.03981c-0.97633,-1.21592 -23.82241,-28.16888 -46.86377,-66.26781c-13.6686,-22.49457 -24.60348,-43.97588 -32.41411,-64.24127c-9.95855,-25.73704 -15.03546,-49.24488 -15.03546,-69.91558c0,-27.96623 10.54435,-54.10858 29.48512,-73.766s44.32532,-30.80338 71.07672,-30.80338s52.13594,10.94331 71.07672,30.60073s29.48512,46.00242 29.48512,73.766c0,20.67069 -5.07691,44.38119 -14.84019,69.91558c-7.81063,20.26539 -18.55024,41.74669 -32.21884,64.24127c-23.04135,38.09892 -45.69217,65.05189 -46.66851,66.06515c-1.56212,2.22919 -3.90531,3.44511 -6.44377,3.44511l0.00001,0.00001z" fill="#007fff" p-id="10263" id="svg_4" stroke="null"/>
<path d="m752.99967,352.33251c36.2234,-0.20914 67.12625,29.00808 67.89883,64.17142c0.78228,35.9476 -30.44127,67.47482 -67.09711,67.73149c-35.50913,0.25192 -67.26231,-29.88266 -68.0203,-64.54217c-0.79686,-36.24228 30.04283,-67.14685 67.21858,-67.36074z" fill="#60a9f2" p-id="19006" id="svg_1" stroke="null"/>
<path d="m286.88155,419.88813c-0.96207,35.1158 -32.35568,65.00321 -67.59757,64.33778c-36.85506,-0.69395 -68.45275,-32.82482 -66.80071,-67.92635c1.69091,-35.88581 31.93781,-64.30927 68.11263,-64.00031c37.11744,0.31846 67.2866,31.08043 66.28566,67.58889l-0.00001,-0.00001z" fill="#60a9f2" p-id="19007" id="svg_2" stroke="null"/>
<path d="m942.63925,81.05485c-16.05394,-59.03333 -45.39222,-80.71215 -108.14057,-80.71691c-252.71834,-0.03802 -505.43181,0.26141 -758.14529,-0.33747c-34.8969,-0.0808 -61.35383,10.18111 -76.35339,42.35475l0,380.33247c12.12791,21.00389 30.94659,28.23809 54.84772,26.76938c15.32996,-0.94586 30.80568,-0.85556 46.14536,0.00475c16.7925,0.93636 24.63969,0.28519 21.67087,-22.03055c-7.56051,-56.69482 37.99205,-104.56315 95.56563,-105.23334c59.01183,-0.68919 104.38947,46.5755 98.34009,104.82933c-1.91928,18.44673 2.44405,22.80531 20.96148,22.6437c94.75905,-0.8508 189.53267,-0.3945 284.30144,-0.3945c33.46352,0 33.46352,0 33.53154,-31.99303c0.10204,-50.12129 39.28939,-91.36858 89.95356,-94.68148c52.71949,-3.45549 98.44698,32.60618 105.67708,81.48692c2.21568,14.96747 -9.95111,35.61488 4.14954,43.23407c13.08999,7.07735 33.16712,1.81092 50.16855,1.95352c4.85894,0.04278 9.72274,0.12358 14.58168,-0.02377c33.94941,-1.03142 47.51072,-12.31999 49.59034,-45.38247c6.82681,-108.80765 1.98245,-216.8263 -26.84564,-322.81537l0,-0.00001l0.00001,0.00001zm-728.07817,47.66396c-0.00486,16.58352 -0.47131,33.1813 0.14091,49.75056c0.50532,13.61283 -4.47509,20.89456 -19.23168,20.80425c-34.71713,-0.20438 -69.4294,-0.09506 -104.14653,-0.03802c-12.47776,0.01902 -19.51836,-4.48216 -19.33372,-18.14728c0.46645,-34.74031 0.50047,-69.49488 0.00971,-104.23519c-0.20407,-14.39235 6.31176,-19.71581 20.41727,-19.56846c33.90568,0.35174 67.82108,0.47532 101.72191,-0.04753c16.04908,-0.24715 21.30645,6.93476 20.60677,21.73587c-0.78229,16.55025 -0.17978,33.16229 -0.18464,49.7458zm203.66733,70.71642a2143.35623,2096.66249 0 0 0 -97.13021,0.00951c-17.97808,0.41827 -24.52307,-6.96327 -24.10034,-24.11716c0.76285,-30.86179 0.85517,-61.78061 -0.02916,-92.6329c-0.51504,-18.06649 5.85017,-26.62204 25.20333,-25.50506c16.13168,0.93161 32.36539,0.19012 48.56024,0.19487c16.18999,0 32.39455,0.44679 48.56024,-0.11883c16.72447,-0.58939 23.3132,6.99655 23.09455,22.89086c-0.42759,31.67456 -0.56363,63.35864 0.05345,95.0237c0.33041,16.95901 -6.21459,24.65426 -24.2121,24.255l0,0.00001zm227.13116,-0.02376c-33.11854,-0.60364 -66.26137,-0.4563 -99.38476,-0.05704c-15.16476,0.17587 -22.17621,-5.71796 -21.96241,-21.03716c0.47132,-33.1908 0.48589,-66.39586 -0.02429,-99.59617c-0.22838,-14.89142 5.52461,-21.72161 21.29187,-21.4887c33.92998,0.50382 67.87939,0.42302 101.80937,0.02852c14.2124,-0.16636 20.96633,5.55635 20.73795,19.60648c-0.27696,16.59778 -0.06802,33.20031 -0.04858,49.79809s-0.47618,33.21932 0.16034,49.79333c0.60736,15.8563 -5.64124,23.25685 -22.5795,22.95266l0.00001,-0.00001zm254.33636,33.25259c-14.5428,-0.57037 -29.12934,-0.14734 -50.62529,-0.14734c-27.67653,4.98598 -58.41904,-1.24531 -83.87503,-27.00704c-6.55957,-6.63531 -11.49139,-11.78765 -11.35048,-21.68834c0.52962,-36.40864 0.73856,-72.84581 -0.06316,-109.24494c-0.30126,-13.65087 4.49938,-17.9524 18.13356,-17.44383c23.43468,0.88883 46.9325,0.12358 70.40118,0.28519c24.88749,0.17111 40.56244,11.38364 47.56417,35.56735c11.96271,41.29957 17.58937,83.53074 22.69125,125.95679c1.28762,10.66117 -2.31772,14.13093 -12.87619,13.72216l-0.00001,0z" fill="#60a9f2" p-id="19008" id="svg_3" stroke="null"/>
</svg>`;
// --- 加载动画控制函数 ---
const loader = {
    overlay: document.getElementById("loading-overlay"),
    bus: document.getElementById("loading-bus-anim"),
    tip: document.getElementById("loading-tip"),
    icon: document.getElementById("loading-icon-svg"),
    timeoutId: null,
    timeoutDuration: 10000, // 默认15秒超时

    show(text = "正在调取实时数据...", timeoutCallback = null) {
        this.icon.innerHTML = busIcon; // 注入图标
        this.tip.textContent = text;
        this.bus.classList.remove("exit");
        this.overlay.classList.remove("hidden");
        this.overlay.style.opacity = "1";
        
        // 设置超时
        if (timeoutCallback) {
            this.clearTimeout(); // 清除之前的超时
            this.timeoutId = setTimeout(() => {
                this.handleTimeout(timeoutCallback);
            }, this.timeoutDuration);
        }
    },

    clearTimeout() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    },

    handleTimeout(callback) {
        this.clearTimeout();
        callback(); // 执行超时回调
    },

    async hide() {
        // 清除可能存在的超时
        this.clearTimeout();
        
        // 1. 公交车淡出/冲出屏幕
        this.bus.classList.add("exit");
        // 2. 等待动画快结束时，隐藏整个遮罩
        return new Promise((resolve) => {
            setTimeout(() => {
                this.overlay.style.opacity = "0";
                setTimeout(() => {
                    this.overlay.classList.add("hidden");
                    resolve();
                }, 500);
            }, 600);
        });
    },
};

// 修改为固定间距
const computeXs = (stations, baseGap = 100) => {
    const xs = [];
    let x = 0;
    stations.forEach((s, i) => {
        if (i === 0) {
            xs.push(0);
        } else {
            x += baseGap;
            xs.push(x);
        }
    });
    return xs;
};

const sx = (xs, i) => xs[i] || 0;
const segLenOf = (stations, toIdx) =>
    Math.max(1, Number(stations[toIdx]?.distanceToSp) || 0);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const betweenX = (xs, from, to, remain, segLen) => {
    const p = clamp01(
        1 - Math.max(0, remain) / Math.max(1, segLen),
    );
    return sx(xs, from) + (sx(xs, to) - sx(xs, from)) * p;
};

const ensureCard = (route, mount, configKey) => {
    let card = document.getElementById(`card-${configKey}`);
    if (!card) {
        card = document.createElement("section");
        card.id = `card-${configKey}`;
        card.className = "card";
        card.innerHTML = `
<div class="corner-hotzone">
    <button class="btn-remove hover-reveal hide-on-mobile" onclick="removeCard('${configKey}')">删除</button>
</div>
<div class="card-header-wrapper">
<div class="line-container">
<div class="line-title"></div>
<div class="card-update-time"></div>
<div class="current-station"></div>
<div class="tips"></div>
</div>
</div>
<div class="strip-wrap">
    <button class="btn left">&lt;</button>
    <div class="strip">
        <div class="content">
            <div class="track-base"></div>
            <div class="st-dots"></div>
            <div class="bus-pin"></div>
            <div class="st-names"></div>
            <div class="vehicles"></div>
        </div>
    </div>
    <button class="btn right">&gt;</button>
</div>

<!-- 即将到站 部分 -->
<h3 class="sec">即将到站</h3>
<div class="list-header">
    <div class="cell">车牌号</div>
    <div class="cell">下一站/距离</div>
    <div class="cell">预计到达本站</div>
</div>
<ul class="bus-list arr-list"></ul>

<!-- 已过站 部分 -->
<h3 class="sec">已经过站</h3>
<div class="list-header">
    <div class="cell">车牌号</div>
    <div class="cell">下一站</div>
    <div class="cell">剩余距离</div>
</div>
<ul class="bus-list miss-list"></ul>
`;
        const strip = card.querySelector(".strip");
        let isDown = false;
        let startX;
        let scrollLeft;

        strip.addEventListener("mousedown", (e) => {
            isDown = true;
            strip.classList.add("active");
            startX = e.pageX - strip.offsetLeft;
            scrollLeft = strip.scrollLeft;
            strip.style.scrollBehavior = "auto"; // 拖拽时关闭平滑滚动，防止卡顿
        });

        strip.addEventListener("mouseleave", () => {
            isDown = false;
        });

        strip.addEventListener("mouseup", () => {
            isDown = false;
            strip.style.scrollBehavior = "smooth"; // 恢复平滑滚动
        });

        strip.addEventListener("mousemove", (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - strip.offsetLeft;
            const walk = (x - startX) * 2; // 滚动速度
            strip.scrollLeft = scrollLeft - walk;
        });
        strip.addEventListener(
            "wheel",
            (e) => {
                // 如果存在垂直滚动偏移量
                if (e.deltaY !== 0) {
                    // 阻止默认的页面垂直滚动
                    e.preventDefault();
                    // 将垂直滚动的数值补偿给横向滚动
                    // 如果觉得滚动太慢，可以乘以一个系数，例如 e.deltaY * 1.5
                    strip.scrollBy({
                        left: e.deltaY,
                        behavior: "auto", // 如果 CSS 中已经设了 smooth，这里用 auto 会更跟手；
                        // 如果希望非常缓慢的丝滑感，可以用 'smooth'
                    });
                }
            },
            { passive: false },
        );
        // --- 鼠标圆圈跟随逻辑 ---
        strip.addEventListener("mousemove", (e) => {
            dom.touchCursor.style.left = e.clientX + "px";
            dom.touchCursor.style.top = e.clientY + "px";
            dom.touchCursor.style.display = "block";
        });

        strip.addEventListener("mouseleave", () => {
            dom.touchCursor.style.display = "none";
        });
        card.querySelector(".btn.left").onclick = () =>
            strip.scrollBy({ left: -260, behavior: "smooth" });
        card.querySelector(".btn.right").onclick = () =>
            strip.scrollBy({ left: 260, behavior: "smooth" });
        mount.appendChild(card);
    }
    return card;
};
const updateCard = (route, card, configKey) => {
    // Basic Info
    card.querySelector(".card-update-time").textContent =
        `更新于: ${route.updatetime}`;
    card.querySelector(".line-title").textContent =
        `${route.lineCode}路 ${route.lineName}`;
    card.querySelector(".current-station").textContent =
        `当前站台: ${route.stationindex}-${route.stationname}`;
    card.querySelector(".tips").textContent =
        "温馨提示: " + route.tip;

    const strip = card.querySelector(".strip");
    const content = card.querySelector(".content");
    const stations = route.stations;
    const xs = computeXs(stations);
    const totalW = xs[xs.length - 1] + 32;
    content.style.width = totalW + "px";
    card.querySelector(".track-base").style.width =
        xs[xs.length - 1] + 8 + "px";

    // Dots, Arrows & Names
    const dotsEl = card.querySelector(".st-dots");
    const namesEl = card.querySelector(".st-names");

    // 简单全量重绘，实际应做Diff优化
    dotsEl.innerHTML = "";
    namesEl.innerHTML = "";

    stations.forEach((s, i) => {
        // 在当前站点和下一个站点之间添加箭头（如果不是最后一个站点）
        if (i < stations.length - 1) {
            const arrow = document.createElement("div");
            arrow.className = "st-arrow";
            // 将箭头放置在两个站点中间
            const arrowX = xs[i] + (xs[i + 1] - xs[i]) / 2;
            arrow.style.left = arrowX + "px";
            arrow.style.position = "absolute";
            arrow.style.top = "22px"; /* 调整垂直位置以居中对齐 */
            arrow.style.width = "20px";
            arrow.style.height = "10px";
            arrow.style.transform = "translateX(-50%)";
            dotsEl.appendChild(arrow);
        }

        // Dot
        const dot = document.createElement("div");
        dot.className = `st-dot ${i + 1 === route.stationindex ? "current" : ""}`;
        dot.style.left = xs[i] + "px";
        dot.innerHTML = `<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:10px;font-weight:700;">${i + 1}</span>`;
        
        // 如果是当前关注的站点，添加公交站牌图标
        if (i + 1 === route.stationindex) {
            const stationIcon = document.createElement("div");
            stationIcon.className = "station-icon";
            stationIcon.style.position = "absolute";
            stationIcon.style.top = "-32px";  // 在站点上方显示
            stationIcon.style.left = "50%";
            stationIcon.style.transform = "translateX(-50%)";
            stationIcon.style.height = "24px";
            stationIcon.style.zIndex = "10";
            stationIcon.style.pointerEvents = "none";
            // 添加一个默认的公交站牌SVG图标
            stationIcon.innerHTML = `<svg t="1770485686409" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="14352" width="32" height="32"><path d="M841.386008 0.138581H184.730255a47.991371 47.991371 0 0 0-47.854838 47.854838v492.474748c0 26.487414 21.503957 47.923104 47.854838 47.923104h289.58662v371.64299h75.093184V588.596071h291.975949a47.991371 47.991371 0 0 0 47.923104-47.923104V48.129952a47.923104 47.923104 0 0 0-47.923104-47.991371z m-656.655753 39.594588h656.655753c4.573858 0 8.328517 3.754659 8.328517 8.396783v166.502067H176.333471V48.061685c0-4.573858 3.822926-8.26025 8.396784-8.26025z m656.655753 509.268314H184.730255a8.328517 8.328517 0 0 1-8.328517-8.328516V289.725202h673.381053V540.672967a8.533316 8.533316 0 0 1-8.396783 8.328516z m-594.601478-446.258307h162.269543v46.899106H246.852797v-46.899106z m4.505591 232.379268h39.594588v157.900485h-39.594588V335.122444z m160.972478 0.750932h39.594588v157.217819h-39.594588V335.873376z m159.607148 0h39.594587v157.217819h-39.594587V335.873376z m160.699412 0h39.594587v157.217819h-39.594587V335.873376z" fill="#67e8f9" p-id="14353"></path></svg>`;
            dot.appendChild(stationIcon);
        }

        // --- 点击处理逻辑 ---
        const handleStationClick = () => {
            // 1. 在多线路数组中找到当前线路的配置
            const config = monitoredConfigs.find(
                (c) =>
                    `${c.city}-${c.line}-${c.reverse}` ===
                    configKey,
            );

            if (config) {
                // 2. 更新该线路关注的站名
                config.station = s.name;

                // 3. 更新 URL
                updateUrl();

                // 4. 立即触发一次局部刷新（静默更新）
                if (window.triggerManualRefresh) {
                    window.triggerManualRefresh();
                }
            }
        };
        // 为圆点添加点击
        dot.style.cursor = "pointer"; // 增加手型指示
        dot.onclick = handleStationClick;
        dotsEl.appendChild(dot);

        // Name
        const name = document.createElement("div");
        name.className = `st-name ${i + 1 === route.stationindex ? "current" : ""}`;
        name.style.left = xs[i] + "px";

        const grp = document.createElement("div");
        grp.className = "name-group";
        s.name.split("").forEach((char, idx) => {
            const sp = document.createElement("span");
            sp.className = "name-chunk";
            sp.textContent = char;
            grp.appendChild(sp);
        });
        name.appendChild(grp);
        if (s.metros && s.metros.length) {
            const metroContainer = document.createElement("div");
            metroContainer.style.display = "flex";
            metroContainer.style.flexDirection = "column";
            metroContainer.style.gap = "2px";
            metroContainer.style.writingMode = "horizontal-tb";
            metroContainer.style.marginTop = "2px";

            s.metros.forEach((metro) => {
                const metroSpan = document.createElement("span");
                // 去除空格
                const fullName = (metro.fullName || "").replace(
                    /\s/g,
                    "",
                );
                metroSpan.textContent = fullName;

                if (metro.color) {
                    // 使用返回的 RGB 颜色
                    metroSpan.style.backgroundColor =
                        "rgb(" + metro.color + ")";
                    metroSpan.style.color = "#FFFFFF";
                    metroSpan.style.padding = "2px 4px";
                    metroSpan.style.borderRadius = "3px";
                    metroSpan.style.display = "grid";
                    // 保持内部文字竖排
                    metroSpan.style.writingMode = "vertical-rl";
                    metroSpan.style.textOrientation = "upright";
                    metroSpan.style.fontSize = "8px";
                    metroSpan.style.fontWeight = "bold";
                    metroSpan.style.lineHeight = "1";
                }
                metroContainer.appendChild(metroSpan);
            });
            name.appendChild(metroContainer);
        }
        name.style.cursor = "pointer";
        name.onclick = handleStationClick;
        namesEl.appendChild(name);
    });

    // Vehicles
    const vehEl = card.querySelector(".vehicles");
    vehEl.innerHTML = "";
    const carXs = [];

    // 合并 arrBus 和 missBus 逻辑
    [...(route.arrBus || []), ...(route.missBus || [])].forEach(
        (bus) => {
            // 找到目标站点索引
            const toIdx = bus.nextstoporder - 1; // bus.order 是 1-based
            if (toIdx < 0 || toIdx >= stations.length) return;

            const fromIdx = toIdx - 1;
            let x = 0;
            if (fromIdx < 0)
                x = sx(xs, toIdx); // 刚发车
            else
                x = betweenX(
                    xs,
                    fromIdx,
                    toIdx,
                    Number(bus.distanceToSc || 0),
                    segLenOf(stations, toIdx),
                );

            carXs.push(x);

            const v = document.createElement("div");
            v.className = "vehicle-pin";
            v.style.left = x + "px";
            // v.style.top = "20px";
            v.innerHTML = busIcon;
            vehEl.appendChild(v);
        },
    );

    // User Pin
    const pinX = sx(xs, route.stationindex - 1);
    const busPin = card.querySelector(".bus-pin");
    busPin.style.left = pinX + "px";

    // Auto Scroll (Center)
    if (!card.dataset.scrolled) {
        strip.scrollLeft = pinX - strip.offsetWidth / 2;
        card.dataset.scrolled = "1";
    }

    // Lists
    const ulArr = card.querySelector(".arr-list");
    const ulMiss = card.querySelector(".miss-list");

    const renderList = (list, isArr) => {
        if (!list || !list.length)
            return '<li><div class="cell" style="flex:3">暂无车辆信息</div></li>';

        return list
            .map((b) => {
                const orderPrefix = b.order ? `${b.order}-` : "";
                if (isArr) {
                    // --- 即将到站渲染逻辑 (表头: 车牌 | 目标站/距离 | 预计到站) ---
                    return `
                <li>
                    <div class="cell cell-1">${b.busId || "--"}</div>
                    <div class="cell cell-2">
                        <div class="target">
                            <div class="st">${b.stationName || "--"}</div>
                            <div class="dist">${b.distanceToSc}米</div>
                        </div>
                    </div>
                    <div class="cell cell-3" style="">${b.recommTip}</div>
                </li>`;
                } else {
                    // --- 已过站渲染逻辑 (表头: 车牌 | 下一站 | 距离) ---
                    // 注意：这里的 b.stationName 实际上就是车辆前方的站点（即下一站）
                    return `
                <li>
                    <div class="cell cell-1">${b.busId || "--"}</div>
                    <div class="cell cell-2" style="font-size:15px;">${b.stationName || "--"}</div>
                    <div class="cell cell-3">${b.distanceToSc}米</div>
                </li>`;
                }
            })
            .join("");
    };

    ulArr.innerHTML = renderList(route.arrBus, true);
    ulMiss.innerHTML = renderList(route.missBus, false);
};
/**
 * ------------------------------------------------------------------
 * 3. 页面控制逻辑
 * ------------------------------------------------------------------
 */
const cl = new CheLaile();
const dom = {
    form: document.getElementById("search-form"),
    view: document.getElementById("view-container"),
    inputCity: document.getElementById("input-city"),
    inputLine: document.getElementById("input-line"),
    inputStation: document.getElementById("input-station"),
    inputReverse: document.getElementById("input-reverse"),
    btnStart: document.getElementById("btn-start"),
    btnStop: document.getElementById("btn-stop"),
    mount: document.getElementById("mount"),
    errMsg: document.getElementById("error-msg"),
    header: document.getElementById("line-info-header"),
    headerTitle: document.getElementById("info-line-name"),
    btnCopy: document.getElementById("btn-copy"),
    inputImmersive: document.getElementById("input-immersive"),
    touchCursor: document.getElementById("touch-cursor"),
};
const suggestEl = document.getElementById("city-suggest");
let cityData = [];
let cityLoaded = false;
function norm(s) {
    return String(s || "").trim();
}
function toUpper(s) {
    return norm(s).toUpperCase();
}
// 将 "ZhangJiaKou" -> "ZJK"
function pinyinInitials(pinyin) {
    const py = norm(pinyin);
    if (!py) return "";
    return py
        .replace(/[^A-Za-z]/g, "") // 只保留字母
        .replace(/[a-z]/g, "") // 只保留大写字母（题设：首字母大写）
        .toUpperCase();
}

// 命中规则：中文包含；拼音包含（忽略大小写）；首字母包含（例如 ZJK）
function matchCity(item, q) {
    const query = norm(q);
    if (!query) return false;

    const cityName = norm(item.cityName);
    const py = norm(item.pinyin);
    const pyU = py.toUpperCase();
    const qU = query.toUpperCase();

    // 1) 中文
    if (cityName.includes(query)) return true;
    // 2) 首字母
    const ini = pinyinInitials(py);
    if (ini && ini.includes(qU)) return true;

    return false;
}

function hideSuggest() {
    suggestEl.classList.add("hidden");
    suggestEl.innerHTML = "";
}

function renderSuggest(list, q) {
    if (!list.length) {
        hideSuggest();
        return;
    }

    suggestEl.innerHTML = list
        .map((c) => {
            const ini = pinyinInitials(c.pinyin);
            const meta = `${c.pinyin || ""}${ini ? " / " + ini : ""}`;
            return `<div class="item" data-name="${c.cityName}">
<div>${c.cityName}</div>
<div class="meta">${meta}</div>
</div>`;
        })
        .join("");

    suggestEl.classList.remove("hidden");

    // 点击回填
    Array.from(suggestEl.querySelectorAll(".item")).forEach(
        (el) => {
            el.addEventListener("mousedown", (e) => {
                // 用 mousedown 防止 input blur 后列表先消失导致 click 不触发
                e.preventDefault();
                const name = el.getAttribute("data-name");
                dom.inputCity.value = name;
                hideSuggest();
                // 触发你现有的 input 监听（autoFetcher）继续走后续查询 [file:1]
                dom.inputCity.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
            });
        },
    );
}

async function ensureCityData() {
    if (cityLoaded) return;
    const cities = await cl.getCities();
    if (!cities) return;
    const data = cities;
    cityData = cities
        .filter((x) => x && x.cityName)
        .map((x) => ({
            cityName: String(x.cityName),
            cityId: String(x.cityId || ""),
            pinyin: String(x.pinyin || ""),
        }));
    cityLoaded = true;
}

// 输入时过滤 + 展示
const citySuggestFetcher = debounce(async () => {
    const q = dom.inputCity.value;
    if (norm(q).length < 1) {
        hideSuggest();
        return;
    }

    await ensureCityData();

    const matched = cityData
        .filter((item) => matchCity(item, q))
        .sort((a, b) =>
            a.cityName.localeCompare(b.cityName, "zh-Hans-CN"),
        )
        .slice(0, 12);

    renderSuggest(matched, q);
}, 120);

// 聚焦时可预加载
dom.inputCity.addEventListener("focus", () => {
    ensureCityData();
});
dom.inputCity.addEventListener("input", citySuggestFetcher);

// 失焦隐藏（延迟一点，兼容 mousedown 选择）
dom.inputCity.addEventListener("blur", () =>
    setTimeout(hideSuggest, 120),
);

// 点击空白处隐藏
document.addEventListener("click", (e) => {
    if (e.target === dom.inputCity) return;
    if (suggestEl.contains(e.target)) return;
    hideSuggest();
});

let refreshTimer = null;
let monitoredConfigs = [];
async function copyToClipboard() {
    try {
        await navigator.clipboard.writeText(window.location.href);
        const originalText = dom.btnCopy.textContent;
        dom.btnCopy.textContent = "已复制！";
        dom.btnCopy.style.background = "#10b981"; // 变绿反馈
        setTimeout(() => {
            dom.btnCopy.textContent = originalText;
            dom.btnCopy.style.background = "#0ea5e9";
        }, 2000);
    } catch (err) {
        alert("复制失败，请手动复制地址栏链接");
    }
}

// 工具：防抖函数
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

function showError(msg) {
    dom.errMsg.textContent = msg;
}

// 1. 获取站点信息 (自动触发)
async function fetchLineStations(isAuto = false) {
    const city = dom.inputCity.value.trim();
    const line = dom.inputLine.value.trim();
    const reverse = dom.inputReverse.checked ? "1" : "0";

    // 如果是自动触发，且输入太短，则不查询
    // 改进：设置更合理的最小输入长度
    if (isAuto && (city.length < 2 || line.length < 2)) return;
    
    // 如果是自动触发（输入过程中），不显示加载动画
    if (isAuto) {
        // 不显示加载动画，但仍需处理可能的超时
        // 创建一个简单的超时标记，避免在输入过程中显示动画
        try {
            const cityId = await cl.getCityIdByName(city);
            if (!cityId) throw new Error("未找到该城市");

            const lineInfo = await cl.getLineInfoByName(
                cityId,
                line,
                reverse,
            );
            if (!lineInfo)
                throw new Error("未找到线路 (请检查方向/线路号)");

            const detailRes = await cl.getBusInfoByLineId(
                cityId,
                lineInfo.lineId,
            );
            if (!detailRes || detailRes.status != "00")
                throw new Error("无法获取站点列表");

            // 成功：更新 UI
            // A. 更新标题
            dom.header.classList.add("active");
            dom.headerTitle.innerHTML = `${lineInfo.name}路 ${lineInfo.startSn} <span class='arrow'></span> ${lineInfo.endSn}`;

            // B. 填充 Select
            const stations = detailRes.data.stations;
            dom.inputStation.innerHTML = stations
                .map(
                    (s) =>
                        `<option value="${s.sn}">${s.order}.${s.sn}</option>`,
                )
                .join("");
            dom.inputStation.disabled = false;
            // C. 显示开始按钮
            dom.btnStart.classList.remove("hidden");
            dom.errMsg.textContent = "";
            return true; // 标识成功
        } catch (e) {
            dom.header.classList.remove("active");
            dom.inputStation.innerHTML = "<option>查询失败</option>";
            dom.btnStart.classList.add("hidden");
            return false;
        }
    } else {
        // 非自动触发（如点击开始按钮）时显示加载动画
        const timeoutCallback = () => {
            showError("获取公交数据超时，请检查网络连接或稍后再试");
            dom.header.classList.remove("active");
            dom.inputStation.innerHTML = "<option>获取数据超时</option>";
            dom.btnStart.classList.add("hidden");
            loader.hide(); // 隐藏加载动画
        };
        
        loader.show(`正在查找 ${city} ${line}路...`, timeoutCallback);
    }
    try {
        const cityId = await cl.getCityIdByName(city);
        if (!cityId) throw new Error("未找到该城市");

        const lineInfo = await cl.getLineInfoByName(
            cityId,
            line,
            reverse,
        );
        if (!lineInfo)
            throw new Error("未找到线路 (请检查方向/线路号)");

        const detailRes = await cl.getBusInfoByLineId(
            cityId,
            lineInfo.lineId,
        );
        if (!detailRes || detailRes.status != "00")
            throw new Error("无法获取站点列表");

        // 成功：更新 UI
        // A. 更新标题
        dom.header.classList.add("active");
        dom.headerTitle.innerHTML = `${lineInfo.name}路 ${lineInfo.startSn} <span class='arrow'></span> ${lineInfo.endSn}`;

        // B. 填充 Select
        const stations = detailRes.data.stations;
        dom.inputStation.innerHTML = stations
            .map(
                (s) =>
                    `<option value="${s.sn}">${s.order}.${s.sn}</option>`,
            )
            .join("");
        dom.inputStation.disabled = false;
        // C. 显示开始按钮
        dom.btnStart.classList.remove("hidden");
        dom.errMsg.textContent = "";
        await loader.hide(); // 动画离场
        return true; // 标识成功
    } catch (e) {
        await loader.hide();
        dom.header.classList.remove("active");
        dom.inputStation.innerHTML = "<option>查询失败</option>";
        dom.btnStart.classList.add("hidden");
        return false;
    }
}

// 2. 启动/停止监控
function stopTracking() {
    dom.view.classList.add("hidden");
    dom.form.classList.remove("hidden");
}

// 删除某个线路
window.removeCard = (key) => {
    monitoredConfigs = monitoredConfigs.filter(
        (c) => `${c.city}-${c.line}-${c.reverse}` !== key,
    );
    const card = document.getElementById(`card-${key}`);
    if (card) card.remove();
    updateUrl();
    if (monitoredConfigs.length === 0) {
        if (refreshTimer) clearInterval(refreshTimer);
        stopTracking();
    }
};

// 更新 URL，支持多线路分享
function updateUrl() {
    const url = new URL(window.location);
    // 将配置数组转为 base64 或者是简写的查询字符串
    if (monitoredConfigs.length > 0) {
        const data = monitoredConfigs
            .map(
                (c) =>
                    `${c.city},${c.line},${c.station},${c.reverse}`,
            )
            .join(";");
        url.searchParams.set("m", data);
    } else {
        url.searchParams.delete("m");
    }
    if (dom.inputImmersive.checked) {
        url.searchParams.set("hidden", "1");
        dom.view.classList.add("immersive");
    } else {
        url.searchParams.delete("hidden");
        dom.view.classList.remove("immersive");
    }

    // 清除单线路旧参数
    url.searchParams.delete("city");
    url.searchParams.delete("line");
    url.searchParams.delete("station");
    url.searchParams.delete("reverse");
    window.history.replaceState({}, "", url.toString());
}
async function startTracking() {
    const isImmersive = dom.inputImmersive.checked;
    const formConfig = {
        city: dom.inputCity.value.trim(),
        line: dom.inputLine.value.trim(),
        reverse: dom.inputReverse.checked ? "1" : "0",
        station: dom.inputStation.value,
        immersive: isImmersive,
    };
    if (isImmersive) {
        dom.view.classList.add("immersive");
    } else {
        dom.view.classList.remove("immersive");
    }
    if (formConfig.city && formConfig.line && formConfig.station) {
        // 调用内部封装函数
        monitoredConfigs = [formConfig];
        updateUrl();
        await window.startTrackingInternal(monitoredConfigs);
    } else {
        showError("请先完整填写线路信息");
    }
}
window.startTrackingInternal = async (configs) => {
    if (configs) {
        monitoredConfigs = configs;
    }

    // 1. 显示加载动画
    const firstConfig = monitoredConfigs[0];
    
    // 添加超时回调函数
    const timeoutCallback = () => {
        showError("获取实时公交数据超时，请检查网络连接或稍后再试");
        dom.form.classList.remove("hidden");
        dom.view.classList.add("hidden");
        loader.hide(); // 隐藏加载动画
    };

    loader.show(`正在查询 ${firstConfig.city} ${firstConfig.line} 路公交信息...`, timeoutCallback);

    try {
        // 2. 准备挂载点和循环逻辑
        dom.mount.innerHTML = "";
        dom.form.classList.add("hidden");
        dom.view.classList.remove("hidden");
        // 定义 loop (即 triggerManualRefresh)
        const loop = async () => {
            for (const config of monitoredConfigs) {
                const configKey = `${config.city}-${config.line}-${config.reverse}`;
                try {
                    const data = await cl.getTripInfo(
                        config.city,
                        config.line,
                        config.reverse,
                        config.station,
                    );
                    if (data) {
                        const card = ensureCard(
                            data,
                            dom.mount,
                            configKey,
                        );
                        updateCard(data, card, configKey);
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        };

        window.triggerManualRefresh = loop;

        // 3. 执行第一次数据抓取
        await loop();

        // 4. 数据加载成功，公交车加速离场
        await loader.hide();

        // 5. 切换 UI 界面
        dom.form.classList.add("hidden");
        dom.view.classList.remove("hidden");

        // 6. 开启定时刷新
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(loop, 30000);
    } catch (e) {
        await loader.hide();
        showError("查询实时公交失败: " + e.message);
    }
};
// 3. 事件绑定
// 改进：增加防抖延迟时间至1000毫秒，避免输入过程中的频繁查询
const autoFetcher = debounce(() => fetchLineStations(true), 1000);

dom.inputCity.addEventListener("input", autoFetcher);
dom.inputLine.addEventListener("input", autoFetcher);
dom.inputReverse.addEventListener("change", () =>
    fetchLineStations(true),
); // Checkbox 立即触发
dom.btnStart.addEventListener("click", startTracking);
dom.btnStop.addEventListener("click", stopTracking);
dom.btnCopy.addEventListener("click", copyToClipboard);
dom.inputImmersive.addEventListener("change", updateUrl);
// 4. URL 参数初始化逻辑
async function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const multiData = params.get("m");
    const pCity = params.get("city");
    const pLine = params.get("line");

    if (multiData || (pCity && pLine)) {
        // 如果是从 URL 直接进入，显示全屏加载
        const timeoutCallback = () => {
            showError("同步实时数据超时，请检查网络连接或稍后再试");
            loader.hide(); // 隐藏加载动画
        };
        loader.show("正在同步实时数据，请稍候...", timeoutCallback);
    }
    if (params.get("hidden") === "1") {
        dom.inputImmersive.checked = true;
    }
    if (multiData) {
        const configs = multiData.split(";");
        const tempConfigs = [];
        for (const item of configs) {
            const parts = item.split(",");
            if (parts.length < 3) continue;
            let city = parts[0];
            let line = parts[1];
            let station = parts[2]; // 这里使用 let，允许后面修改
            let reverse = parts[3] || "0";
            const isIndex =
                !isNaN(parseInt(station)) && station.length < 3;
            if (isIndex) {
                try {
                    const cityId = await cl.getCityIdByName(city);
                    const lineInfo = await cl.getLineInfoByName(
                        cityId,
                        line,
                        reverse,
                    );
                    const detail = await cl.getBusInfoByLineId(
                        cityId,
                        lineInfo.lineId,
                    );
                    const idx = parseInt(station);
                    // 转换为真实站名
                    if (detail.data.stations[idx - 1]) {
                        station = detail.data.stations[idx - 1].sn;
                    }
                } catch (e) {
                    console.error("转换站点索引失败", e);
                }
            }
            tempConfigs.push({ city, line, station, reverse });
        }
        if (tempConfigs.length > 0) {
            monitoredConfigs = tempConfigs;
            updateUrl();
            await window.startTrackingInternal(monitoredConfigs);
        }
    } else if (pCity && pLine) {
        dom.inputCity.value = pCity;
        dom.inputLine.value = pLine;
        if (params.get("reverse") === "1")
            dom.inputReverse.checked = true;
        // 2. 主动调用查询，并等待网络请求结束 (关键步骤)
        // 注意：这里必须 await，否则下拉框还没数据就去选站点会失败
        const success = await fetchLineStations(false);
        const pStation = params.get("station");
        if (success && pStation) {
            // 3. 智能匹配站点 (支持 URL 仅输入关键词)
            let matchedValue = "";
            const options = Array.from(dom.inputStation.options);

            const stationIdx = parseInt(pStation);
            if (
                !isNaN(stationIdx) &&
                stationIdx > 0 &&
                stationIdx <= options.length
            ) {
                // 如果是数字，直接取对应的 Option
                matchedValue = options[stationIdx - 1].value;
            } else {
                // 如果是文字，执行模糊匹配
                const exact = options.find(
                    (opt) => opt.value === pStation,
                );
                const partial = options.find((opt) =>
                    opt.value.includes(pStation),
                );
                matchedValue = exact
                    ? exact.value
                    : partial
                        ? partial.value
                        : "";
            }

            if (matchedValue) {
                dom.inputStation.value = matchedValue;
                await window.startTrackingInternal();
            } else {
                showError(`未能识别站点 "${pStation}"，请手动选择`);
            }
        }
    }
    await loader.hide();
}

// 启动初始化
initFromUrl();