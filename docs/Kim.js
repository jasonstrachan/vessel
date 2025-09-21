!function n(i, o, a) {
    function s(t, e) {
        if (!o[t]) {
            if (!i[t]) {
                var r = "function" == typeof require && require;
                if (!e && r)
                    return r(t, !0);
                if (c)
                    return c(t, !0);
                throw (r = new Error("Cannot find module '" + t + "'")).code = "MODULE_NOT_FOUND",
                r
            }
            r = o[t] = {
                exports: {}
            },
            i[t][0].call(r.exports, function(e) {
                return s(i[t][1][e] || e)
            }, r, r.exports, n, i, o, a)
        }
        return o[t].exports
    }
    for (var c = "function" == typeof require && require, e = 0; e < a.length; e++)
        s(a[e]);
    return s
}({
    1: [function(e, t, r) {
        const n = e("page")
          , i = e("webgl-context")
          , x = i({
            antialias: !0
        })
          , o = i({
            antialias: !0
        })
          , a = e("gl-reset")(x)
          , b = e("./lib/app-default")
          , s = e("./lib/app-logo")
          , c = e("./lib/item")
          , d = e("./lib/objkt-loader").doFetchTokens
          , p = e("./lib/objkt-loader").doFetchSales
          , E = "monogrid"
          , v = "tz1V7MkP1N5bBJasgDxyBvmGLxRBnjcwaNvG";
        let f, l = document.getElementById("logo");
        let w, T = document.getElementById("obj-overlay"), A = document.getElementById("loading");
        const R = () => {
            w && (T.removeChild(w.canvas),
            w.dispose(),
            w = null,
            a())
        }
        ;
        let u = document.getElementById("auction-timer")
          , h = setInterval( () => {
            let e = new Date;
            var t, r, n = 1634918364 - Math.floor(e.getTime() / 1e3);
            n <= 0 ? clearInterval(h) : (t = Math.floor(n / 3600),
            r = Math.floor((n - 3600 * t) / 60),
            n %= 60,
            u.innerText = g(t) + ":" + g(r) + ":" + g(n))
        }
        , 250);
        const g = e => e < 10 ? "0" + e : e;
        let y = document.getElementById("message");
        let I = document.getElementById("info-and-timeline-overlay")
          , U = document.getElementById("about-the-grid-overlay")
          , P = document.getElementById("about-the-artist-overlay");
        var m = () => {
            let e = document.createElement("input");
            var t;
            e.value = "kimasendorf#3468",
            e.select(),
            e.setSelectionRange(0, 99999),
            navigator.clipboard.writeText(e.value),
            t = "Copied: " + e.value,
            y.innerText = t,
            y.style.display = "block",
            setTimeout( () => {
                y.style.display = "none"
            }
            , 2e3)
        }
        ;
        let _ = document.getElementById("discord-name-copy1")
          , S = document.getElementById("discord-name-copy2")
          , N = document.getElementById("discord-name-copy3");
        _.addEventListener("click", m, !1),
        S.addEventListener("click", m, !1),
        N.addEventListener("click", m, !1);
        let M = []
          , L = document.getElementById("items")
          , C = document.getElementById("pricing-scheme");
        const B = e => {
            if (e.lowest_ask)
                return e.lowest_ask / 1e6
        }
          , F = (t, e) => {
            let r = void 0
              , n = 0;
            var i = e.listing.find(e => e.token.token_id == t.token_id);
            !i || (o = Date.parse(i.timestamp)) > n && (r = i.price_xtz / 1e6,
            n = o);
            var o = e.offer.find(e => e.token.token_id == t.token_id);
            !o || (a = Date.parse(o.timestamp)) > n && (r = o.price_xtz / 1e6,
            n = a);
            var a = e.english_auction.find(e => e.token.token_id == t.token_id);
            !a || (s = Date.parse(a.end_time)) > n && (r = a.highest_bid_xtz / 1e6,
            n = s);
            var s, a = e.dutch_auction.find(e => e.token.token_id == t.token_id);
            return !a || (s = Date.parse(a.end_time)) > n && (r = a.end_price_xtz / 1e6,
            n = s),
            r
        }
        ;
        let D = {
            prevRowId: void 0,
            nextRowId: void 0,
            prevColumnId: void 0,
            nextColumnId: void 0,
            reloadId: void 0
        };
        document.onkeydown = e => {
            switch ((e = e || window.event).key) {
            case "Escape":
                n("/");
                break;
            case "Enter":
                D.reloadId && (e.preventDefault(),
                n("/id/" + D.reloadId));
                break;
            case "ArrowUp":
                D.prevRowId && (e.preventDefault(),
                n("/id/" + D.prevRowId));
                break;
            case "ArrowDown":
                D.nextRowId && (e.preventDefault(),
                n("/id/" + D.nextRowId));
                break;
            case "ArrowLeft":
                D.prevColumnId && (e.preventDefault(),
                n("/id/" + D.prevColumnId));
                break;
            case "ArrowRight":
                D.nextColumnId && (e.preventDefault(),
                n("/id/" + D.nextColumnId));
                break;
            case "F":
                z()
            }
        }
        ;
        const z = () => {
            document.fullscreenElement ? document.exitFullscreen && document.exitFullscreen() : document.documentElement.requestFullscreen()
        }
        ;
        document.addEventListener("fullscreenchange", e => {
            (document.fullscreenElement ? O : j)()
        }
        );
        const O = () => {
            document.getElementById("overlay-meta-data").style.display = "none",
            document.getElementById("overlay-links").style.display = "none",
            document.getElementById("overlay-grid-nav").style.display = "none"
        }
          , j = () => {
            document.getElementById("overlay-meta-data").style.display = "block",
            document.getElementById("overlay-links").style.display = "block",
            document.getElementById("overlay-grid-nav").style.display = "block"
        }
          , k = () => {
            document.documentElement.style.overflow = "hidden",
            document.body.scroll = "no",
            document.body.style.msOverflowStyle = "none"
        }
        ;
        n("/", () => {
            I.style.display = "none",
            U.style.display = "none",
            P.style.display = "none",
            T.style.display = "none",
            R(),
            document.documentElement.style.overflow = "scroll",
            document.body.scroll = "yes",
            document.body.style.msOverflowStyle = "auto",
            D = {
                prevRowId: void 0,
                nextRowId: void 0,
                prevColumnId: void 0,
                nextColumnId: void 0,
                reloadId: void 0
            }
        }
        ),
        n("/id/:id", t => {
            I.style.display = "none",
            U.style.display = "none",
            P.style.display = "none";
            let e = parseInt(t.params.id.charAt(0), 16)
              , r = parseInt(t.params.id.charAt(1), 16);
            var n, i;
            R(),
            k(),
            n = e,
            i = r,
            T.style.display = "block",
            A.style.display = "block",
            w = b(x, T, n, i),
            T.appendChild(w.canvas),
            A.style.display = "none";
            let o = M.find(e => e.id === t.params.id);
            document.getElementById("obj-title").innerText = o.id,
            o.objkt ? (document.getElementById("obj-owner").innerText = o.owner.alias || o.owner.address,
            document.getElementById("obj-owner").href = o.owner.alias ? "https://teia.art/" + o.owner.alias : "https://teia.art/tz/" + o.owner.address,
            document.getElementById("obj-current-price").innerText = isNaN(o.currentPrice) ? o.currentPrice : o.currentPrice.toLocaleString() + " tez",
            document.getElementById("obj-last-price").innerHTML = isNaN(o.lastPrice) ? o.lastPrice : o.lastPrice.toLocaleString() + " tez",
            document.getElementById("obj-ipfs").href = "https://ipfs.io/ipfs/" + o.objkt.artifact_uri.split("//")[1],
            document.getElementById("obj-objkt").href = "https://objkt.com/asset/hicetnunc/" + o.objkt.token_id) : (document.getElementById("obj-owner").innerText = E,
            document.getElementById("obj-owner").href = "https://teia.art/" + E,
            document.getElementById("obj-current-price").innerText = o.initialPrice.toLocaleString() + " tez",
            document.getElementById("obj-last-price").innerText = "0 tez",
            document.getElementById("obj-ipfs").removeAttribute("href"),
            document.getElementById("obj-hen").removeAttribute("href"),
            document.getElementById("obj-objkt").removeAttribute("href"));
            let a = document.getElementById("overlay-nav-prev-row")
              , s = e - 1 < 0 ? 15 : e - 1;
            var c = s.toString(16) + r.toString(16);
            a.innerText = c,
            a.href = "/id/" + c;
            let f = document.getElementById("overlay-nav-next-row")
              , l = 16 <= e + 1 ? 0 : e + 1;
            var u = l.toString(16) + r.toString(16);
            f.innerText = u,
            f.href = "/id/" + u;
            let h = document.getElementById("overlay-nav-prev-column")
              , d = r - 1 < 0 ? 15 : r - 1;
            var p = e.toString(16) + d.toString(16);
            h.innerText = p,
            h.href = "/id/" + p;
            let v = document.getElementById("overlay-nav-next-column")
              , g = 16 <= r + 1 ? 0 : r + 1;
            var y = e.toString(16) + g.toString(16);
            v.innerText = y,
            v.href = "/id/" + y;
            let m = document.getElementById("overlay-nav-reload");
            var _ = e.toString(16) + r.toString(16);
            m.innerText = _,
            m.href = "/id/" + _,
            D = {
                prevRowId: c,
                nextRowId: u,
                prevColumnId: p,
                nextColumnId: y,
                reloadId: _
            }
        }
        ),
        n("/info-and-timeline", () => {
            U.style.display = "none",
            P.style.display = "none",
            T.style.display = "none",
            I.style.display = "flex",
            k()
        }
        ),
        n("/about-the-grid", () => {
            I.style.display = "none",
            P.style.display = "none",
            T.style.display = "none",
            U.style.display = "flex",
            k()
        }
        ),
        n("/about-the-artist", () => {
            I.style.display = "none",
            U.style.display = "none",
            T.style.display = "none",
            P.style.display = "flex",
            k()
        }
        ),
        n("*", () => {
            n.redirect("/")
        }
        );
        window.addEventListener("load", async () => {
            ( () => {
                for (let n = 0; n < 16; n++)
                    for (let t = 0; t < 16; t++) {
                        var r = c(n, t);
                        M.push(r),
                        L.appendChild(r.elements.item);
                        let e = document.createElement("div");
                        e.classList.add("price-tag"),
                        e.innerText = r.initialPrice,
                        C.appendChild(e)
                    }
            }
            )(),
            A.style.display = "none",
            document.getElementById("wrapper").style.display = "block",
            f = s(o, l),
            l.appendChild(f.canvas);
            try {
                await (async () => {
                    let e = await d(v);
                    var t, r, n, i, o, a, s = await p();
                    let c = []
                      , f = 0
                      , l = []
                      , u = 0;
                    for ([t,r] of e.entries()) {
                        let e = M[t];
                        e.objkt = r,
                        e.owner = r.holders[0].holder;
                        var h = e.owner.alias || e.owner.address;
                        e.elements.owner.innerText = h,
                        c.includes(h) || c.push(h);
                        h = F(e.objkt, s);
                        h ? (e.lastPrice = h,
                        e.elements.lastPrice.innerHTML = '<div class="label">' + e.lastPrice.toLocaleString() + '</div><div class="label">tez</div>') : (e.lastPrice = "unknown",
                        e.elements.lastPrice.innerHTML = '<div class="label">unknown</div>');
                        h = B(e.objkt);
                        h ? (e.currentPrice = h,
                        e.elements.currentPrice.innerHTML = e.currentPrice.toLocaleString() + "<br>tez",
                        e.elements.currentPrice.classList.add("on-sale"),
                        l.push(e.currentPrice),
                        f++,
                        e.elements.lastPrice.remove()) : (e.currentPrice = "Not for sale",
                        e.elements.currentPrice.innerHTML = e.currentPrice)
                    }
                    for (n of s.listing)
                        u += n.price_xtz / 1e6;
                    for (i of s.offer)
                        u += i.price_xtz / 1e6;
                    for (o of s.english_auction)
                        u += o.highest_bid_xtz / 1e6;
                    for (a of s.dutch_auction)
                        u += a.end_price_xtz / 1e6;
                    document.getElementById("stats-owners").innerText = c.length,
                    document.getElementById("stats-available").innerText = f,
                    document.getElementById("stats-floor-price").innerText = Math.min(...l).toLocaleString(),
                    document.getElementById("stats-volume-traded").innerText = Math.round(u).toLocaleString()
                }
                )()
            } catch (e) {
                console.error(e)
            }
            n.start({
                hashbang: !1
            })
        }
        , !1)
    }
    , {
        "./lib/app-default": 2,
        "./lib/app-logo": 3,
        "./lib/item": 6,
        "./lib/objkt-loader": 7,
        "gl-reset": 29,
        page: 60,
        "webgl-context": 74
    }],
    2: [function(e, t, r) {
        let s = e("./app")
          , c = e("object-assign")
          , E = e("gl-fbo")
          , f = e("gl-shader")
          , w = e("gl-texture2d")
          , n = e("glslify")
          , T = e("ndarray")
          , A = e("ndarray-fill")
          , l = e("a-big-triangle")
          , R = e("./grid-generator")
          , u = n(["#define GLSLIFY 1\nattribute vec2 position;\n\nvarying vec2 vUv;\n\nvoid main() {\n  gl_Position = vec4(position, 0.0, 1.0);\n  vUv = 0.5 * (position + 1.0);\n}"])
          , I = n(['precision highp float;\n#define GLSLIFY 1\n\nuniform sampler2D buffer;\nuniform sampler2D tex;\nuniform vec2 dims;\nuniform float time;\n\nuniform vec4 rect0;\nuniform vec4 rect1;\nuniform vec4 rect2;\nuniform vec4 rect3;\nuniform vec4 rect4;\nuniform vec4 rect5;\nuniform vec4 rect6;\nuniform vec4 rect7;\nuniform vec4 rect8;\nuniform vec4 rect9;\nuniform vec4 rect10;\nuniform vec4 rect11;\nuniform vec4 rect12;\nuniform vec4 rect13;\nuniform vec4 rect14;\nuniform vec4 rect15;\n\nvarying vec2 vUv;\n\n// #pragma glslify: cellular2D = require(\'./cellular2D\')\n// Cellular noise ("Worley noise") in 2D in GLSL.\n// Copyright (c) Stefan Gustavson 2011-04-19. All rights reserved.\n// This code is released under the conditions of the MIT license.\n// See LICENSE file for details.\n// https://github.com/stegu/webgl-noise\n\n// Modulo 289 without a division (only multiplications)\nvec2 mod289_2(vec2 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289_2(vec4 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\n// Modulo 7 without a division\nvec4 mod7(vec4 x) {\n  return x - floor(x * (1.0 / 7.0)) * 7.0;\n}\n\n// Permutation polynomial: (34x^2 + x) mod 289\nvec4 permute_2(vec4 x) {\n  return mod289_2((34.0 * x + 1.0) * x);\n}\n\n// Cellular noise, returning F1 and F2 in a vec2.\n// Speeded up by using 2x2 search window instead of 3x3,\n// at the expense of some strong pattern artifacts.\n// F2 is often wrong and has sharp discontinuities.\n// If you need a smooth F2, use the slower 3x3 version.\n// F1 is sometimes wrong, too, but OK for most purposes.\nvec2 cellular2x2(vec2 P) {\n#define K 0.142857142857 // 1/7\n#define K2 0.0714285714285 // K/2\n#define jitter 0.8 // jitter 1.0 makes F1 wrong more often\n  vec2 Pi = mod289_2(floor(P));\n  vec2 Pf = fract(P);\n  vec4 Pfx = Pf.x + vec4(-0.5, -1.5, -0.5, -1.5);\n  vec4 Pfy = Pf.y + vec4(-0.5, -0.5, -1.5, -1.5);\n  vec4 p = permute_2(Pi.x + vec4(0.0, 1.0, 0.0, 1.0));\n  p = permute_2(p + Pi.y + vec4(0.0, 0.0, 1.0, 1.0));\n  vec4 ox = mod7(p)*K+K2;\n  vec4 oy = mod7(floor(p*K))*K+K2;\n  vec4 dx = Pfx + jitter*ox;\n  vec4 dy = Pfy + jitter*oy;\n  vec4 d = dx * dx + dy * dy; // d11, d12, d21 and d22, squared\n  // Sort out the two smallest distances\n#if 0\n  // Cheat and pick only F1\n  d.xy = min(d.xy, d.zw);\n  d.x = min(d.x, d.y);\n  return vec2(sqrt(d.x)); // F1 duplicated, F2 not computed\n#else\n  // Do it right and find both F1 and F2\n  d.xy = (d.x < d.y) ? d.xy : d.yx; // Swap if smaller\n  d.xz = (d.x < d.z) ? d.xz : d.zx;\n  d.xw = (d.x < d.w) ? d.xw : d.wx;\n  d.y = min(d.y, d.z);\n  d.y = min(d.y, d.w);\n  return sqrt(d.xy);\n#endif\n}\n\n// #pragma glslify: cellular2x2x2 = require(\'./cellular2x2x2\')\n// #pragma glslify: cellular3D = require(\'./cellular3D\')\n//\n// Fractional Brownian motion\n// https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83\n//\nfloat rand(float n) {\n  return fract(sin(n) * 43758.5453123);\n}\n\nfloat noise(float p) {\n  float fl = floor(p);\n  float fc = fract(p);\n  return mix(rand(fl), rand(fl + 1.0), fc);\n}\n\nfloat rand(vec2 n) { \n  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);\n}\n\nfloat noise(vec2 p){\n  vec2 ip = floor(p);\n  vec2 u = fract(p);\n  u = u*u*(3.0-2.0*u);\n\n  float res = mix(mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x), mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x), u.y);\n  return res*res;\n}\n\nfloat mod289_3(float x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\nvec4 mod289_3(vec4 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\nvec4 perm(vec4 x) {\n  return mod289_3(((x * 34.0) + 1.0) * x);\n}\n\nfloat noise(vec3 p) {\n  vec3 a = floor(p);\n  vec3 d = p - a;\n  d = d * d * (3.0 - 2.0 * d);\n\n  vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);\n  vec4 k1 = perm(b.xyxy);\n  vec4 k2 = perm(k1.xyxy + b.zzww);\n\n  vec4 c = k2 + a.zzzz;\n  vec4 k3 = perm(c);\n  vec4 k4 = perm(c + 1.0);\n\n  vec4 o1 = fract(k3 * (1.0 / 41.0));\n  vec4 o2 = fract(k4 * (1.0 / 41.0));\n\n  vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);\n  vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);\n\n  return o4.y * d.y + o4.x * (1.0 - d.y);\n}\n\n#define NUM_OCTAVES 8\n\nfloat fbm(float x) {\n  float v = 0.0;\n  float a = 0.5;\n  float shift = float(100);\n  for (int i = 0; i < NUM_OCTAVES; ++i) {\n    v += a * noise(x);\n    x = x * 2.0 + shift;\n    a *= 0.5;\n  }\n  return v;\n}\n\nfloat fbm(vec2 x) {\n  float v = 0.0;\n  float a = 0.5;\n  vec2 shift = vec2(100);\n  // Rotate to reduce axial bias\n    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));\n  for (int i = 0; i < NUM_OCTAVES; ++i) {\n    v += a * noise(x);\n    x = rot * x * 2.0 + shift;\n    a *= 0.5;\n  }\n  return v;\n}\n\nfloat fbm(vec3 x) {\n  float v = 0.0;\n  float a = 0.5;\n  vec3 shift = vec3(100);\n  for (int i = 0; i < NUM_OCTAVES; ++i) {\n    v += a * noise(x);\n    x = x * 2.0 + shift;\n    a *= 0.5;\n  }\n  return v;\n}\n\n// #pragma glslify: snoise2 = require(glsl-noise/simplex/2d)\n//\n// Description : Array and textureless GLSL 2D/3D/4D simplex\n//               noise functions.\n//      Author : Ian McEwan, Ashima Arts.\n//  Maintainer : ijm\n//     Lastmod : 20110822 (ijm)\n//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.\n//               Distributed under the MIT License. See LICENSE file.\n//               https://github.com/ashima/webgl-noise\n//\n\nvec3 mod289_0(vec3 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289_0(vec4 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 permute_0(vec4 x) {\n     return mod289_0(((x*34.0)+1.0)*x);\n}\n\nvec4 taylorInvSqrt_0(vec4 r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nfloat snoise(vec3 v)\n  {\n  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;\n  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);\n\n// First corner\n  vec3 i  = floor(v + dot(v, C.yyy) );\n  vec3 x0 =   v - i + dot(i, C.xxx) ;\n\n// Other corners\n  vec3 g = step(x0.yzx, x0.xyz);\n  vec3 l = 1.0 - g;\n  vec3 i1 = min( g.xyz, l.zxy );\n  vec3 i2 = max( g.xyz, l.zxy );\n\n  //   x0 = x0 - 0.0 + 0.0 * C.xxx;\n  //   x1 = x0 - i1  + 1.0 * C.xxx;\n  //   x2 = x0 - i2  + 2.0 * C.xxx;\n  //   x3 = x0 - 1.0 + 3.0 * C.xxx;\n  vec3 x1 = x0 - i1 + C.xxx;\n  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y\n  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y\n\n// Permutations\n  i = mod289_0(i);\n  vec4 p = permute_0( permute_0( permute_0(\n             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))\n           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))\n           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));\n\n// Gradients: 7x7 points over a square, mapped onto an octahedron.\n// The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)\n  float n_ = 0.142857142857; // 1.0/7.0\n  vec3  ns = n_ * D.wyz - D.xzx;\n\n  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)\n\n  vec4 x_ = floor(j * ns.z);\n  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)\n\n  vec4 x = x_ *ns.x + ns.yyyy;\n  vec4 y = y_ *ns.x + ns.yyyy;\n  vec4 h = 1.0 - abs(x) - abs(y);\n\n  vec4 b0 = vec4( x.xy, y.xy );\n  vec4 b1 = vec4( x.zw, y.zw );\n\n  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;\n  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;\n  vec4 s0 = floor(b0)*2.0 + 1.0;\n  vec4 s1 = floor(b1)*2.0 + 1.0;\n  vec4 sh = -step(h, vec4(0.0));\n\n  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;\n  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;\n\n  vec3 p0 = vec3(a0.xy,h.x);\n  vec3 p1 = vec3(a0.zw,h.y);\n  vec3 p2 = vec3(a1.xy,h.z);\n  vec3 p3 = vec3(a1.zw,h.w);\n\n//Normalise gradients\n  vec4 norm = taylorInvSqrt_0(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));\n  p0 *= norm.x;\n  p1 *= norm.y;\n  p2 *= norm.z;\n  p3 *= norm.w;\n\n// Mix final noise value\n  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);\n  m = m * m;\n  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),\n                                dot(p2,x2), dot(p3,x3) ) );\n  }\n\n// #pragma glslify: snoise4 = require(glsl-noise/simplex/4d)\n// #pragma glslify: cnoise2 = require(glsl-noise/classic/2d)\n//\n// GLSL textureless classic 3D noise "cnoise",\n// with an RSL-style periodic variant "pnoise".\n// Author:  Stefan Gustavson (stefan.gustavson@liu.se)\n// Version: 2011-10-11\n//\n// Many thanks to Ian McEwan of Ashima Arts for the\n// ideas for permutation and gradient selection.\n//\n// Copyright (c) 2011 Stefan Gustavson. All rights reserved.\n// Distributed under the MIT license. See LICENSE file.\n// https://github.com/ashima/webgl-noise\n//\n\nvec3 mod289_1(vec3 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289_1(vec4 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 permute_1(vec4 x)\n{\n  return mod289_1(((x*34.0)+1.0)*x);\n}\n\nvec4 taylorInvSqrt_1(vec4 r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nvec3 fade_0(vec3 t) {\n  return t*t*t*(t*(t*6.0-15.0)+10.0);\n}\n\n// Classic Perlin noise\nfloat cnoise(vec3 P)\n{\n  vec3 Pi0 = floor(P); // Integer part for indexing\n  vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1\n  Pi0 = mod289_1(Pi0);\n  Pi1 = mod289_1(Pi1);\n  vec3 Pf0 = fract(P); // Fractional part for interpolation\n  vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0\n  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);\n  vec4 iy = vec4(Pi0.yy, Pi1.yy);\n  vec4 iz0 = Pi0.zzzz;\n  vec4 iz1 = Pi1.zzzz;\n\n  vec4 ixy = permute_1(permute_1(ix) + iy);\n  vec4 ixy0 = permute_1(ixy + iz0);\n  vec4 ixy1 = permute_1(ixy + iz1);\n\n  vec4 gx0 = ixy0 * (1.0 / 7.0);\n  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;\n  gx0 = fract(gx0);\n  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);\n  vec4 sz0 = step(gz0, vec4(0.0));\n  gx0 -= sz0 * (step(0.0, gx0) - 0.5);\n  gy0 -= sz0 * (step(0.0, gy0) - 0.5);\n\n  vec4 gx1 = ixy1 * (1.0 / 7.0);\n  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;\n  gx1 = fract(gx1);\n  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);\n  vec4 sz1 = step(gz1, vec4(0.0));\n  gx1 -= sz1 * (step(0.0, gx1) - 0.5);\n  gy1 -= sz1 * (step(0.0, gy1) - 0.5);\n\n  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);\n  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);\n  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);\n  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);\n  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);\n  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);\n  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);\n  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);\n\n  vec4 norm0 = taylorInvSqrt_1(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));\n  g000 *= norm0.x;\n  g010 *= norm0.y;\n  g100 *= norm0.z;\n  g110 *= norm0.w;\n  vec4 norm1 = taylorInvSqrt_1(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));\n  g001 *= norm1.x;\n  g011 *= norm1.y;\n  g101 *= norm1.z;\n  g111 *= norm1.w;\n\n  float n000 = dot(g000, Pf0);\n  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));\n  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));\n  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));\n  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));\n  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));\n  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));\n  float n111 = dot(g111, Pf1);\n\n  vec3 fade_xyz = fade_0(Pf0);\n  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);\n  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);\n  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);\n  return 2.2 * n_xyz;\n}\n\n// #pragma glslify: cnoise4 = require(glsl-noise/classic/4d)\n// #pragma glslify: pnoise2 = require(glsl-noise/periodic/2d)\n//\n// GLSL textureless classic 3D noise "cnoise",\n// with an RSL-style periodic variant "pnoise".\n// Author:  Stefan Gustavson (stefan.gustavson@liu.se)\n// Version: 2011-10-11\n//\n// Many thanks to Ian McEwan of Ashima Arts for the\n// ideas for permutation and gradient selection.\n//\n// Copyright (c) 2011 Stefan Gustavson. All rights reserved.\n// Distributed under the MIT license. See LICENSE file.\n// https://github.com/ashima/webgl-noise\n//\n\nvec3 mod289_4(vec3 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289_4(vec4 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 permute_3(vec4 x)\n{\n  return mod289_4(((x*34.0)+1.0)*x);\n}\n\nvec4 taylorInvSqrt_2(vec4 r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nvec3 fade_1(vec3 t) {\n  return t*t*t*(t*(t*6.0-15.0)+10.0);\n}\n\n// Classic Perlin noise, periodic variant\nfloat pnoise(vec3 P, vec3 rep)\n{\n  vec3 Pi0 = mod(floor(P), rep); // Integer part, modulo period\n  vec3 Pi1 = mod(Pi0 + vec3(1.0), rep); // Integer part + 1, mod period\n  Pi0 = mod289_4(Pi0);\n  Pi1 = mod289_4(Pi1);\n  vec3 Pf0 = fract(P); // Fractional part for interpolation\n  vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0\n  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);\n  vec4 iy = vec4(Pi0.yy, Pi1.yy);\n  vec4 iz0 = Pi0.zzzz;\n  vec4 iz1 = Pi1.zzzz;\n\n  vec4 ixy = permute_3(permute_3(ix) + iy);\n  vec4 ixy0 = permute_3(ixy + iz0);\n  vec4 ixy1 = permute_3(ixy + iz1);\n\n  vec4 gx0 = ixy0 * (1.0 / 7.0);\n  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;\n  gx0 = fract(gx0);\n  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);\n  vec4 sz0 = step(gz0, vec4(0.0));\n  gx0 -= sz0 * (step(0.0, gx0) - 0.5);\n  gy0 -= sz0 * (step(0.0, gy0) - 0.5);\n\n  vec4 gx1 = ixy1 * (1.0 / 7.0);\n  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;\n  gx1 = fract(gx1);\n  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);\n  vec4 sz1 = step(gz1, vec4(0.0));\n  gx1 -= sz1 * (step(0.0, gx1) - 0.5);\n  gy1 -= sz1 * (step(0.0, gy1) - 0.5);\n\n  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);\n  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);\n  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);\n  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);\n  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);\n  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);\n  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);\n  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);\n\n  vec4 norm0 = taylorInvSqrt_2(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));\n  g000 *= norm0.x;\n  g010 *= norm0.y;\n  g100 *= norm0.z;\n  g110 *= norm0.w;\n  vec4 norm1 = taylorInvSqrt_2(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));\n  g001 *= norm1.x;\n  g011 *= norm1.y;\n  g101 *= norm1.z;\n  g111 *= norm1.w;\n\n  float n000 = dot(g000, Pf0);\n  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));\n  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));\n  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));\n  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));\n  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));\n  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));\n  float n111 = dot(g111, Pf1);\n\n  vec3 fade_xyz = fade_1(Pf0);\n  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);\n  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);\n  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);\n  return 2.2 * n_xyz;\n}\n\n// #pragma glslify: pnoise4 = require(glsl-noise/periodic/4d)\n\n// #pragma glslify: map = require(glsl-map)\n\nhighp float random(vec2 co)\n{\n    highp float a = 12.9898;\n    highp float b = 78.233;\n    highp float c = 43758.5453;\n    highp float dt= dot(co.xy ,vec2(a,b));\n    highp float sn= mod(dt,3.14);\n    return fract(sin(sn) * c);\n}\n\n// return 1 if v inside the box, return 0 otherwise\nfloat insideBox(vec2 v, vec2 bottomLeft, vec2 topRight) {\n  vec2 s = step(bottomLeft, v) - step(topRight, v);\n  return s.x * s.y;   \n}\n\n// float insideBox3D(vec3 v, vec3 bottomLeft, vec3 topRight) {\n//   vec3 s = step(bottomLeft, v) - step(topRight, v);\n//   return s.x * s.y * s.z; \n// }\n\nvoid main() {\n  vec3 rgb = texture2D(buffer, vUv).rgb;\n\n  // rect0 (simplex & classic noise)\n  if (insideBox(vUv, vec2(rect0.x / dims.x, rect0.y / dims.y), vec2((rect0.x + rect0.z) / dims.x, (rect0.y + rect0.w) / dims.y)) >= 1.0) {\n    vec2 offset = vec2(snoise(vec3(vUv * 22.0, time)), cnoise(vec3(vUv * 7.0, time * 0.5))) / dims;\n    rgb = texture2D(buffer, vUv + offset).rgb;\n  }\n\n  // rect1 (perlin noise)\n  if (insideBox(vUv, vec2(rect1.x / dims.x, rect1.y / dims.y), vec2((rect1.x + rect1.z) / dims.x, (rect1.y + rect1.w) / dims.y)) >= 1.0) {\n    float x = pnoise(vec3(vUv * 90.0, time * 1.2), vec3(0.34, 5.731, 0.12)) / dims.x;\n    float y = pnoise(vec3(vUv.y * 53.84, time * 1.41, vUv.x * 20.14), vec3(0.89, 0.23, 0.911)) / dims.y;\n    vec2 offset = vec2(x, y);\n    rgb = texture2D(buffer, vUv + offset).rgb;\n  }\n\n  // rect2 (fbm noise)\n  if (insideBox(vUv, vec2(rect2.x / dims.x, rect2.y / dims.y), vec2((rect2.x + rect2.z) / dims.x, (rect2.y + rect2.w) / dims.y)) >= 1.0) {\n    float x = (fbm(vec3(vUv.x * 2.0, vUv.y, time * 5.0)) - 0.5) * 4.0 / dims.x * 1.0; // 2.0\n    float y = (fbm(vec3(time * 3.0, vUv.x, vUv.y * 4.0)) - 0.5) * 8.0 / dims.y * 1.5; // 3.0\n    vec2 offset = vec2(x, y);\n    rgb = texture2D(buffer, vUv + offset).rgb;\n  }\n\n  // rect3 (fbm & simplex noise)\n  if (insideBox(vUv, vec2(rect3.x / dims.x, rect3.y / dims.y), vec2((rect3.x + rect3.z) / dims.x, (rect3.y + rect3.w) / dims.y)) >= 1.0) {\n    float x = (fbm(vec2((vUv.x - 0.5) * 2.0, time * 5.0)) - 0.35) * 4.0 / dims.x + snoise(vec3(vUv.x * 4.3, vUv.y, time * 0.4)) * 0.005; // 0.01\n    float y = (fbm(vec2(time * 3.0, vUv.y * 4.0)) - 0.35) * 4.0 / dims.y + snoise(vec3(vUv.x * 3.3, vUv.y * 3.4, time * 0.38)) * 0.005; // 0.01\n    vec2 offset = vec2(x, y);\n    rgb = texture2D(buffer, vUv + offset).rgb;\n  }\n\n  // rect4 (x+)\n  if (insideBox(vUv, vec2(rect4.x / dims.x, rect4.y / dims.y), vec2((rect4.x + rect4.z) / dims.x, (rect4.y + rect4.w) / dims.y)) >= 1.0) {\n    float offset = 1.0 / dims.x;\n    rgb = texture2D(buffer, vec2(vUv.x + offset, vUv.y)).rgb;\n  }\n\n  // rect5 (x-)\n  if (insideBox(vUv, vec2(rect5.x / dims.x, rect5.y / dims.y), vec2((rect5.x + rect5.z) / dims.x, (rect5.y + rect5.w) / dims.y)) >= 1.0) {\n    float offset = 1.0 / dims.x;\n    rgb = texture2D(buffer, vec2(vUv.x - offset, vUv.y)).rgb;\n  }\n\n  // rect6 (y+)\n  if (insideBox(vUv, vec2(rect6.x / dims.x, rect6.y / dims.y), vec2((rect6.x + rect6.z) / dims.x, (rect6.y + rect6.w) / dims.y)) >= 1.0) {\n    float offset = 1.0 / dims.y;\n    rgb = texture2D(buffer, vec2(vUv.x, vUv.y + offset)).rgb;\n  }\n\n  // rect7 (y-)\n  if (insideBox(vUv, vec2(rect7.x / dims.x, rect7.y / dims.y), vec2((rect7.x + rect7.z) / dims.x, (rect7.y + rect7.w) / dims.y)) >= 1.0) {\n    float offset = 1.0 / dims.y;\n    rgb = texture2D(buffer, vec2(vUv.x, vUv.y - offset)).rgb;\n  }\n\n  // rect8 (animate)\n  if (insideBox(vUv, vec2(rect8.x / dims.x, rect8.y / dims.y), vec2((rect8.x + rect8.z) / dims.x, (rect8.y + rect8.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect8.x;\n    float y = floor(vUv.y * dims.y) - rect8.y;\n    float step = mod(floor(time * 24.0), 16.0);\n\n    if (step == 0.0 && mod(y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x + 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x - 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 8.0 && mod(y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x - 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 8.0 && mod(y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x + 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n  }\n\n  // rect9 (animate)\n  if (insideBox(vUv, vec2(rect9.x / dims.x, rect9.y / dims.y), vec2((rect9.x + rect9.z) / dims.x, (rect9.y + rect9.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect9.x;\n    float y = floor(vUv.y * dims.y) - rect9.y;\n    float step = mod(floor(time * 60.0), 4.0);\n\n    if (step == 0.0 && mod(x, 2.0) == 0.0 && mod(y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x + 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(x, 2.0) == 1.0 && mod(y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x, vUv.y - 1.0 / dims.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(x, 2.0) == 1.0 && mod(y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x - 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(x, 2.0) == 0.0 && mod(y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x, vUv.y + 1.0 / dims.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n  }\n\n  // rect10 (animate)\n  if (insideBox(vUv, vec2(rect10.x / dims.x, rect10.y / dims.y), vec2((rect10.x + rect10.z) / dims.x, (rect10.y + rect10.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect10.x;\n    float y = floor(vUv.y * dims.y) - rect10.y;\n    float step = mod(floor(time * 60.0), 4.0);\n\n    if (step == 0.0 && mod(x + y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x + 1.0 / dims.x, vUv.y - 1.0 / dims.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(x + y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x - 1.0 / dims.x, vUv.y + 1.0 / dims.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n  }\n\n  // rect11 (animate)\n  if (insideBox(vUv, vec2(rect11.x / dims.x, rect11.y / dims.y), vec2((rect11.x + rect11.z) / dims.x, (rect11.y + rect11.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect11.x;\n    float y = floor(vUv.y * dims.y) - rect11.y;\n\n    vec2 pos = vec2(vUv.x, vUv.y + sin(x * 0.1 + time * 2.0) / dims.y * 1.0);\n    rgb = texture2D(buffer, pos).rgb;\n  }\n\n  // rect12 (reset)\n  if (insideBox(vUv, vec2(rect12.x / dims.x, rect12.y / dims.y), vec2((rect12.x + rect12.z) / dims.x, (rect12.y + rect12.w) / dims.y)) >= 1.0) {\n    if (random(vec2(vUv.x + time, vUv.y)) < 0.06) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n  }\n\n  // rect13 (reset)\n  if (insideBox(vUv, vec2(rect13.x / dims.x, rect13.y / dims.y), vec2((rect13.x + rect13.z) / dims.x, (rect13.y + rect13.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect13.x;\n    float y = floor(vUv.y * dims.y) - rect13.y;\n\n    if (mod(x + y, 4.0) == mod(floor(time * 10.0), 4.0) && mod(y, 2.0) == 0.0) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n\n    if (mod(x + y + 1.0, 4.0) == mod(floor(time * 6.0), 4.0) && mod(y, 2.0) == 1.0) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n  }\n\n  // rect14 (reset)\n  if (insideBox(vUv, vec2(rect14.x / dims.x, rect14.y / dims.y), vec2((rect14.x + rect14.z) / dims.x, (rect14.y + rect14.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect14.x;\n    float y = floor(vUv.y * dims.y) - rect14.y;\n    float step = mod(floor(time * 50.0), 16.0);\n\n    if (mod(x, 16.0) == step) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n  }\n\n  // rect15 (reset)\n  if (insideBox(vUv, vec2(rect15.x / dims.x, rect15.y / dims.y), vec2((rect15.x + rect15.z) / dims.x, (rect15.y + rect15.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect15.x;\n    float y = floor(vUv.y * dims.y) - rect15.y;\n    float step = mod(floor(time * 50.0), 16.0);\n\n    if (mod(y, 16.0) == step) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n  }\n\n  vec4 color = vec4(rgb, 1.0);\n\n  gl_FragColor = color;\n}'])
          , U = n(["precision mediump float;\n#define GLSLIFY 1\n\nuniform sampler2D buffer;\n\nvarying vec2 vUv;\n\nvoid main() {\n  gl_FragColor = texture2D(buffer, vUv);\n}"]);
        t.exports = (h, e, d, p) => {
            let n = Math.min(window.devicePixelRatio, 2);
            var t = h.canvas;
            let v = s(t, {
                parent: e,
                scale: n
            }).on("tick", function(e) {
                !function(e) {
                    var t = g[y];
                    g[y ^= 1].bind(),
                    i.bind(),
                    i.uniforms.buffer = t.color[0].bind(0),
                    i.uniforms.tex = m.bind(1),
                    i.uniforms.dims = v.shape,
                    i.uniforms.time = e,
                    i.uniforms.rect0 = _[x[0]],
                    i.uniforms.rect1 = _[x[1]],
                    i.uniforms.rect2 = _[x[2]],
                    i.uniforms.rect3 = _[x[3]],
                    i.uniforms.rect4 = _[x[4]],
                    i.uniforms.rect5 = _[x[5]],
                    i.uniforms.rect6 = _[x[6]],
                    i.uniforms.rect7 = _[x[7]],
                    i.uniforms.rect8 = _[x[8]],
                    i.uniforms.rect9 = _[x[9]],
                    i.uniforms.rect10 = _[x[10]],
                    i.uniforms.rect11 = _[x[11]],
                    i.uniforms.rect12 = _[x[12]],
                    i.uniforms.rect13 = _[x[13]],
                    i.uniforms.rect14 = _[x[14]],
                    i.uniforms.rect15 = _[x[15]],
                    l(h)
                }(a += e / 1e3);
                var [t,r] = v.shape;
                h.bindFramebuffer(h.FRAMEBUFFER, null),
                h.viewport(0, 0, t * n, r * n),
                o.bind(),
                o.uniforms.buffer = g[y].color[0].bind(),
                l(h)
            }).on("dispose", function() {
                i.dispose(),
                g[0].dispose(),
                g[1].dispose(),
                m.dispose();
                for (var e of b)
                    clearTimeout(e)
            }).on("resize", function() {
                for (var e of b)
                    clearTimeout(e);
                r()
            }), i = f(h, u, I), o = f(h, u, U), g, y = 0, m, _ = [], x = [], b = [];
            const r = () => {
                let[n,e] = v.shape;
                g = [E(h, [n, e]), E(h, [n, e])],
                y = 0,
                g[0].color[0].magFilter = h.NEAREST,
                g[0].color[0].minFilter = h.NEAREST,
                g[1].color[0].magFilter = h.NEAREST,
                g[1].color[0].minFilter = h.NEAREST,
                m = w(h, [n, e]);
                var t = d < 8 ? 1 - 1 / 15 * p : 1 / 15 * p
                  , r = Math.floor(.5 * Math.max(1, d - 6))
                  , i = Math.max(0, d - 8) - r
                  , o = Math.max(1, d - 7) + r
                  , a = Math.floor(.5 * Math.max(1, 9 - d))
                  , s = Math.max(2, 9 - d) - a
                  , c = Math.max(3, 10 - d) + a
                  , r = 1 - .064 * (Math.abs(p - 7.5) - .5)
                  , a = 1 - .064 * (Math.abs(d - 7.5) - .5)
                  , r = R(v.shape, {
                    pixelSizeMin: i,
                    pixelSizeMax: o,
                    gapSizeMin: s,
                    gapSizeMax: c,
                    rectWidthMin: 32,
                    rectHeightMin: 32,
                    splitDepthVertical: a,
                    splitDepthHorizontal: r,
                    blackWhiteBalance: t
                });
                let f = r.grid;
                t = T(new Uint8Array(n * e * 4), [n, e, 4]);
                A(t, (e, t, r) => 3 === r ? 255 : 255 * f[e + t * n]),
                g[0].color[0].setPixels(t),
                m.setPixels(t),
                _ = r.rects,
                x = [],
                b = [];
                let l = e => {
                    var t = Math.floor(8e3 * Math.random());
                    return setTimeout(function() {
                        x[e] = Math.floor(Math.random() * _.length),
                        l(e)
                    }, t)
                }
                ;
                for (let u = 0; u < 16; u++)
                    x.push(Math.floor(Math.random() * _.length)),
                    b[u] = l(u)
            }
            ;
            r(),
            i.attributes.position.location = 0,
            o.attributes.position.location = 0,
            h.disable(h.DEPTH_TEST);
            var a = 0;
            return v.start(),
            c(v, {
                canvas: t,
                gl: h
            })
        }
    }
    , {
        "./app": 4,
        "./grid-generator": 5,
        "a-big-triangle": 8,
        "gl-fbo": 27,
        "gl-shader": 31,
        "gl-texture2d": 38,
        glslify: 51,
        ndarray: 58,
        "ndarray-fill": 56,
        "object-assign": 59
    }],
    3: [function(e, t, r) {
        let v = e("./app")
          , g = e("object-assign")
          , y = e("gl-fbo")
          , m = e("gl-shader")
          , _ = e("gl-texture2d")
          , n = e("glslify")
          , x = e("ndarray")
          , b = e("ndarray-fill")
          , E = e("a-big-triangle")
          , w = e("./grid-generator")
          , T = n(["#define GLSLIFY 1\nattribute vec2 position;\n\nvarying vec2 vUv;\n\nvoid main() {\n  gl_Position = vec4(position, 0.0, 1.0);\n  vUv = 0.5 * (position + 1.0);\n}"])
          , A = n(['precision highp float;\n#define GLSLIFY 1\n\nuniform sampler2D buffer;\nuniform sampler2D tex;\nuniform vec2 dims;\nuniform float time;\n\nuniform vec4 rect0;\nuniform vec4 rect1;\nuniform vec4 rect2;\nuniform vec4 rect3;\nuniform vec4 rect4;\nuniform vec4 rect5;\nuniform vec4 rect6;\nuniform vec4 rect7;\nuniform vec4 rect8;\nuniform vec4 rect9;\nuniform vec4 rect10;\nuniform vec4 rect11;\nuniform vec4 rect12;\nuniform vec4 rect13;\nuniform vec4 rect14;\nuniform vec4 rect15;\n\nvarying vec2 vUv;\n\n// #pragma glslify: cellular2D = require(\'./cellular2D\')\n// Cellular noise ("Worley noise") in 2D in GLSL.\n// Copyright (c) Stefan Gustavson 2011-04-19. All rights reserved.\n// This code is released under the conditions of the MIT license.\n// See LICENSE file for details.\n// https://github.com/stegu/webgl-noise\n\n// Modulo 289 without a division (only multiplications)\nvec2 mod289_2(vec2 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289_2(vec4 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\n// Modulo 7 without a division\nvec4 mod7(vec4 x) {\n  return x - floor(x * (1.0 / 7.0)) * 7.0;\n}\n\n// Permutation polynomial: (34x^2 + x) mod 289\nvec4 permute_2(vec4 x) {\n  return mod289_2((34.0 * x + 1.0) * x);\n}\n\n// Cellular noise, returning F1 and F2 in a vec2.\n// Speeded up by using 2x2 search window instead of 3x3,\n// at the expense of some strong pattern artifacts.\n// F2 is often wrong and has sharp discontinuities.\n// If you need a smooth F2, use the slower 3x3 version.\n// F1 is sometimes wrong, too, but OK for most purposes.\nvec2 cellular2x2(vec2 P) {\n#define K 0.142857142857 // 1/7\n#define K2 0.0714285714285 // K/2\n#define jitter 0.8 // jitter 1.0 makes F1 wrong more often\n  vec2 Pi = mod289_2(floor(P));\n  vec2 Pf = fract(P);\n  vec4 Pfx = Pf.x + vec4(-0.5, -1.5, -0.5, -1.5);\n  vec4 Pfy = Pf.y + vec4(-0.5, -0.5, -1.5, -1.5);\n  vec4 p = permute_2(Pi.x + vec4(0.0, 1.0, 0.0, 1.0));\n  p = permute_2(p + Pi.y + vec4(0.0, 0.0, 1.0, 1.0));\n  vec4 ox = mod7(p)*K+K2;\n  vec4 oy = mod7(floor(p*K))*K+K2;\n  vec4 dx = Pfx + jitter*ox;\n  vec4 dy = Pfy + jitter*oy;\n  vec4 d = dx * dx + dy * dy; // d11, d12, d21 and d22, squared\n  // Sort out the two smallest distances\n#if 0\n  // Cheat and pick only F1\n  d.xy = min(d.xy, d.zw);\n  d.x = min(d.x, d.y);\n  return vec2(sqrt(d.x)); // F1 duplicated, F2 not computed\n#else\n  // Do it right and find both F1 and F2\n  d.xy = (d.x < d.y) ? d.xy : d.yx; // Swap if smaller\n  d.xz = (d.x < d.z) ? d.xz : d.zx;\n  d.xw = (d.x < d.w) ? d.xw : d.wx;\n  d.y = min(d.y, d.z);\n  d.y = min(d.y, d.w);\n  return sqrt(d.xy);\n#endif\n}\n\n// #pragma glslify: cellular2x2x2 = require(\'./cellular2x2x2\')\n// #pragma glslify: cellular3D = require(\'./cellular3D\')\n//\n// Fractional Brownian motion\n// https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83\n//\nfloat rand(float n) {\n  return fract(sin(n) * 43758.5453123);\n}\n\nfloat noise(float p) {\n  float fl = floor(p);\n  float fc = fract(p);\n  return mix(rand(fl), rand(fl + 1.0), fc);\n}\n\nfloat rand(vec2 n) { \n  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);\n}\n\nfloat noise(vec2 p){\n  vec2 ip = floor(p);\n  vec2 u = fract(p);\n  u = u*u*(3.0-2.0*u);\n\n  float res = mix(mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x), mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x), u.y);\n  return res*res;\n}\n\nfloat mod289_3(float x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\nvec4 mod289_3(vec4 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\nvec4 perm(vec4 x) {\n  return mod289_3(((x * 34.0) + 1.0) * x);\n}\n\nfloat noise(vec3 p) {\n  vec3 a = floor(p);\n  vec3 d = p - a;\n  d = d * d * (3.0 - 2.0 * d);\n\n  vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);\n  vec4 k1 = perm(b.xyxy);\n  vec4 k2 = perm(k1.xyxy + b.zzww);\n\n  vec4 c = k2 + a.zzzz;\n  vec4 k3 = perm(c);\n  vec4 k4 = perm(c + 1.0);\n\n  vec4 o1 = fract(k3 * (1.0 / 41.0));\n  vec4 o2 = fract(k4 * (1.0 / 41.0));\n\n  vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);\n  vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);\n\n  return o4.y * d.y + o4.x * (1.0 - d.y);\n}\n\n#define NUM_OCTAVES 8\n\nfloat fbm(float x) {\n  float v = 0.0;\n  float a = 0.5;\n  float shift = float(100);\n  for (int i = 0; i < NUM_OCTAVES; ++i) {\n    v += a * noise(x);\n    x = x * 2.0 + shift;\n    a *= 0.5;\n  }\n  return v;\n}\n\nfloat fbm(vec2 x) {\n  float v = 0.0;\n  float a = 0.5;\n  vec2 shift = vec2(100);\n  // Rotate to reduce axial bias\n    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));\n  for (int i = 0; i < NUM_OCTAVES; ++i) {\n    v += a * noise(x);\n    x = rot * x * 2.0 + shift;\n    a *= 0.5;\n  }\n  return v;\n}\n\nfloat fbm(vec3 x) {\n  float v = 0.0;\n  float a = 0.5;\n  vec3 shift = vec3(100);\n  for (int i = 0; i < NUM_OCTAVES; ++i) {\n    v += a * noise(x);\n    x = x * 2.0 + shift;\n    a *= 0.5;\n  }\n  return v;\n}\n\n// #pragma glslify: snoise2 = require(glsl-noise/simplex/2d)\n//\n// Description : Array and textureless GLSL 2D/3D/4D simplex\n//               noise functions.\n//      Author : Ian McEwan, Ashima Arts.\n//  Maintainer : ijm\n//     Lastmod : 20110822 (ijm)\n//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.\n//               Distributed under the MIT License. See LICENSE file.\n//               https://github.com/ashima/webgl-noise\n//\n\nvec3 mod289_0(vec3 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289_0(vec4 x) {\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 permute_0(vec4 x) {\n     return mod289_0(((x*34.0)+1.0)*x);\n}\n\nvec4 taylorInvSqrt_0(vec4 r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nfloat snoise(vec3 v)\n  {\n  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;\n  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);\n\n// First corner\n  vec3 i  = floor(v + dot(v, C.yyy) );\n  vec3 x0 =   v - i + dot(i, C.xxx) ;\n\n// Other corners\n  vec3 g = step(x0.yzx, x0.xyz);\n  vec3 l = 1.0 - g;\n  vec3 i1 = min( g.xyz, l.zxy );\n  vec3 i2 = max( g.xyz, l.zxy );\n\n  //   x0 = x0 - 0.0 + 0.0 * C.xxx;\n  //   x1 = x0 - i1  + 1.0 * C.xxx;\n  //   x2 = x0 - i2  + 2.0 * C.xxx;\n  //   x3 = x0 - 1.0 + 3.0 * C.xxx;\n  vec3 x1 = x0 - i1 + C.xxx;\n  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y\n  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y\n\n// Permutations\n  i = mod289_0(i);\n  vec4 p = permute_0( permute_0( permute_0(\n             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))\n           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))\n           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));\n\n// Gradients: 7x7 points over a square, mapped onto an octahedron.\n// The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)\n  float n_ = 0.142857142857; // 1.0/7.0\n  vec3  ns = n_ * D.wyz - D.xzx;\n\n  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)\n\n  vec4 x_ = floor(j * ns.z);\n  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)\n\n  vec4 x = x_ *ns.x + ns.yyyy;\n  vec4 y = y_ *ns.x + ns.yyyy;\n  vec4 h = 1.0 - abs(x) - abs(y);\n\n  vec4 b0 = vec4( x.xy, y.xy );\n  vec4 b1 = vec4( x.zw, y.zw );\n\n  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;\n  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;\n  vec4 s0 = floor(b0)*2.0 + 1.0;\n  vec4 s1 = floor(b1)*2.0 + 1.0;\n  vec4 sh = -step(h, vec4(0.0));\n\n  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;\n  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;\n\n  vec3 p0 = vec3(a0.xy,h.x);\n  vec3 p1 = vec3(a0.zw,h.y);\n  vec3 p2 = vec3(a1.xy,h.z);\n  vec3 p3 = vec3(a1.zw,h.w);\n\n//Normalise gradients\n  vec4 norm = taylorInvSqrt_0(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));\n  p0 *= norm.x;\n  p1 *= norm.y;\n  p2 *= norm.z;\n  p3 *= norm.w;\n\n// Mix final noise value\n  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);\n  m = m * m;\n  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),\n                                dot(p2,x2), dot(p3,x3) ) );\n  }\n\n// #pragma glslify: snoise4 = require(glsl-noise/simplex/4d)\n// #pragma glslify: cnoise2 = require(glsl-noise/classic/2d)\n//\n// GLSL textureless classic 3D noise "cnoise",\n// with an RSL-style periodic variant "pnoise".\n// Author:  Stefan Gustavson (stefan.gustavson@liu.se)\n// Version: 2011-10-11\n//\n// Many thanks to Ian McEwan of Ashima Arts for the\n// ideas for permutation and gradient selection.\n//\n// Copyright (c) 2011 Stefan Gustavson. All rights reserved.\n// Distributed under the MIT license. See LICENSE file.\n// https://github.com/ashima/webgl-noise\n//\n\nvec3 mod289_4(vec3 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289_4(vec4 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 permute_3(vec4 x)\n{\n  return mod289_4(((x*34.0)+1.0)*x);\n}\n\nvec4 taylorInvSqrt_2(vec4 r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nvec3 fade_1(vec3 t) {\n  return t*t*t*(t*(t*6.0-15.0)+10.0);\n}\n\n// Classic Perlin noise\nfloat cnoise(vec3 P)\n{\n  vec3 Pi0 = floor(P); // Integer part for indexing\n  vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1\n  Pi0 = mod289_4(Pi0);\n  Pi1 = mod289_4(Pi1);\n  vec3 Pf0 = fract(P); // Fractional part for interpolation\n  vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0\n  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);\n  vec4 iy = vec4(Pi0.yy, Pi1.yy);\n  vec4 iz0 = Pi0.zzzz;\n  vec4 iz1 = Pi1.zzzz;\n\n  vec4 ixy = permute_3(permute_3(ix) + iy);\n  vec4 ixy0 = permute_3(ixy + iz0);\n  vec4 ixy1 = permute_3(ixy + iz1);\n\n  vec4 gx0 = ixy0 * (1.0 / 7.0);\n  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;\n  gx0 = fract(gx0);\n  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);\n  vec4 sz0 = step(gz0, vec4(0.0));\n  gx0 -= sz0 * (step(0.0, gx0) - 0.5);\n  gy0 -= sz0 * (step(0.0, gy0) - 0.5);\n\n  vec4 gx1 = ixy1 * (1.0 / 7.0);\n  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;\n  gx1 = fract(gx1);\n  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);\n  vec4 sz1 = step(gz1, vec4(0.0));\n  gx1 -= sz1 * (step(0.0, gx1) - 0.5);\n  gy1 -= sz1 * (step(0.0, gy1) - 0.5);\n\n  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);\n  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);\n  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);\n  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);\n  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);\n  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);\n  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);\n  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);\n\n  vec4 norm0 = taylorInvSqrt_2(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));\n  g000 *= norm0.x;\n  g010 *= norm0.y;\n  g100 *= norm0.z;\n  g110 *= norm0.w;\n  vec4 norm1 = taylorInvSqrt_2(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));\n  g001 *= norm1.x;\n  g011 *= norm1.y;\n  g101 *= norm1.z;\n  g111 *= norm1.w;\n\n  float n000 = dot(g000, Pf0);\n  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));\n  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));\n  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));\n  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));\n  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));\n  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));\n  float n111 = dot(g111, Pf1);\n\n  vec3 fade_xyz = fade_1(Pf0);\n  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);\n  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);\n  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);\n  return 2.2 * n_xyz;\n}\n\n// #pragma glslify: cnoise4 = require(glsl-noise/classic/4d)\n// #pragma glslify: pnoise2 = require(glsl-noise/periodic/2d)\n//\n// GLSL textureless classic 3D noise "cnoise",\n// with an RSL-style periodic variant "pnoise".\n// Author:  Stefan Gustavson (stefan.gustavson@liu.se)\n// Version: 2011-10-11\n//\n// Many thanks to Ian McEwan of Ashima Arts for the\n// ideas for permutation and gradient selection.\n//\n// Copyright (c) 2011 Stefan Gustavson. All rights reserved.\n// Distributed under the MIT license. See LICENSE file.\n// https://github.com/ashima/webgl-noise\n//\n\nvec3 mod289_1(vec3 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289_1(vec4 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 permute_1(vec4 x)\n{\n  return mod289_1(((x*34.0)+1.0)*x);\n}\n\nvec4 taylorInvSqrt_1(vec4 r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nvec3 fade_0(vec3 t) {\n  return t*t*t*(t*(t*6.0-15.0)+10.0);\n}\n\n// Classic Perlin noise, periodic variant\nfloat pnoise(vec3 P, vec3 rep)\n{\n  vec3 Pi0 = mod(floor(P), rep); // Integer part, modulo period\n  vec3 Pi1 = mod(Pi0 + vec3(1.0), rep); // Integer part + 1, mod period\n  Pi0 = mod289_1(Pi0);\n  Pi1 = mod289_1(Pi1);\n  vec3 Pf0 = fract(P); // Fractional part for interpolation\n  vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0\n  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);\n  vec4 iy = vec4(Pi0.yy, Pi1.yy);\n  vec4 iz0 = Pi0.zzzz;\n  vec4 iz1 = Pi1.zzzz;\n\n  vec4 ixy = permute_1(permute_1(ix) + iy);\n  vec4 ixy0 = permute_1(ixy + iz0);\n  vec4 ixy1 = permute_1(ixy + iz1);\n\n  vec4 gx0 = ixy0 * (1.0 / 7.0);\n  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;\n  gx0 = fract(gx0);\n  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);\n  vec4 sz0 = step(gz0, vec4(0.0));\n  gx0 -= sz0 * (step(0.0, gx0) - 0.5);\n  gy0 -= sz0 * (step(0.0, gy0) - 0.5);\n\n  vec4 gx1 = ixy1 * (1.0 / 7.0);\n  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;\n  gx1 = fract(gx1);\n  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);\n  vec4 sz1 = step(gz1, vec4(0.0));\n  gx1 -= sz1 * (step(0.0, gx1) - 0.5);\n  gy1 -= sz1 * (step(0.0, gy1) - 0.5);\n\n  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);\n  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);\n  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);\n  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);\n  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);\n  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);\n  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);\n  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);\n\n  vec4 norm0 = taylorInvSqrt_1(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));\n  g000 *= norm0.x;\n  g010 *= norm0.y;\n  g100 *= norm0.z;\n  g110 *= norm0.w;\n  vec4 norm1 = taylorInvSqrt_1(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));\n  g001 *= norm1.x;\n  g011 *= norm1.y;\n  g101 *= norm1.z;\n  g111 *= norm1.w;\n\n  float n000 = dot(g000, Pf0);\n  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));\n  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));\n  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));\n  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));\n  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));\n  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));\n  float n111 = dot(g111, Pf1);\n\n  vec3 fade_xyz = fade_0(Pf0);\n  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);\n  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);\n  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);\n  return 2.2 * n_xyz;\n}\n\n// #pragma glslify: pnoise4 = require(glsl-noise/periodic/4d)\n\n// #pragma glslify: map = require(glsl-map)\n\nhighp float random(vec2 co)\n{\n    highp float a = 12.9898;\n    highp float b = 78.233;\n    highp float c = 43758.5453;\n    highp float dt= dot(co.xy ,vec2(a,b));\n    highp float sn= mod(dt,3.14);\n    return fract(sin(sn) * c);\n}\n\n// return 1 if v inside the box, return 0 otherwise\nfloat insideBox(vec2 v, vec2 bottomLeft, vec2 topRight) {\n  vec2 s = step(bottomLeft, v) - step(topRight, v);\n  return s.x * s.y;   \n}\n\n// float insideBox3D(vec3 v, vec3 bottomLeft, vec3 topRight) {\n//   vec3 s = step(bottomLeft, v) - step(topRight, v);\n//   return s.x * s.y * s.z; \n// }\n\nvoid main() {\n  vec3 rgb = texture2D(buffer, vUv).rgb;\n\n  // rect0 (simplex & classic noise)\n  if (insideBox(vUv, vec2(rect0.x / dims.x, rect0.y / dims.y), vec2((rect0.x + rect0.z) / dims.x, (rect0.y + rect0.w) / dims.y)) >= 1.0) {\n    vec2 offset = vec2(snoise(vec3(vUv * 22.0, time)), cnoise(vec3(vUv * 7.0, time * 0.5))) / dims;\n    rgb = texture2D(buffer, vUv + offset).rgb;\n  }\n\n  // rect1 (perlin noise)\n  if (insideBox(vUv, vec2(rect1.x / dims.x, rect1.y / dims.y), vec2((rect1.x + rect1.z) / dims.x, (rect1.y + rect1.w) / dims.y)) >= 1.0) {\n    float x = pnoise(vec3(vUv * 90.0, time * 1.2), vec3(0.34, 5.731, 0.12)) / dims.x;\n    float y = pnoise(vec3(vUv.y * 53.84, time * 1.41, vUv.x * 20.14), vec3(0.89, 0.23, 0.911)) / dims.y;\n    vec2 offset = vec2(x, y);\n    rgb = texture2D(buffer, vUv + offset).rgb;\n  }\n\n  // rect2 (fbm noise)\n  if (insideBox(vUv, vec2(rect2.x / dims.x, rect2.y / dims.y), vec2((rect2.x + rect2.z) / dims.x, (rect2.y + rect2.w) / dims.y)) >= 1.0) {\n    float x = (fbm(vec3(vUv.x * 2.0, vUv.y, time * 5.0)) - 0.5) * 4.0 / dims.x * 1.0; // 2.0\n    float y = (fbm(vec3(time * 3.0, vUv.x, vUv.y * 4.0)) - 0.5) * 8.0 / dims.y * 1.5; // 3.0\n    vec2 offset = vec2(x, y);\n    rgb = texture2D(buffer, vUv + offset).rgb;\n  }\n\n  // rect3 (fbm & simplex noise)\n  if (insideBox(vUv, vec2(rect3.x / dims.x, rect3.y / dims.y), vec2((rect3.x + rect3.z) / dims.x, (rect3.y + rect3.w) / dims.y)) >= 1.0) {\n    float x = (fbm(vec2((vUv.x - 0.5) * 2.0, time * 5.0)) - 0.35) * 4.0 / dims.x + snoise(vec3(vUv.x * 4.3, vUv.y, time * 0.4)) * 0.005; // 0.01\n    float y = (fbm(vec2(time * 3.0, vUv.y * 4.0)) - 0.35) * 4.0 / dims.y + snoise(vec3(vUv.x * 3.3, vUv.y * 3.4, time * 0.38)) * 0.005; // 0.01\n    vec2 offset = vec2(x, y);\n    rgb = texture2D(buffer, vUv + offset).rgb;\n  }\n\n  // rect4 (x+)\n  if (insideBox(vUv, vec2(rect4.x / dims.x, rect4.y / dims.y), vec2((rect4.x + rect4.z) / dims.x, (rect4.y + rect4.w) / dims.y)) >= 1.0) {\n    float offset = 1.0 / dims.x;\n    rgb = texture2D(buffer, vec2(vUv.x + offset, vUv.y)).rgb;\n  }\n\n  // rect5 (x-)\n  if (insideBox(vUv, vec2(rect5.x / dims.x, rect5.y / dims.y), vec2((rect5.x + rect5.z) / dims.x, (rect5.y + rect5.w) / dims.y)) >= 1.0) {\n    float offset = 1.0 / dims.x;\n    rgb = texture2D(buffer, vec2(vUv.x - offset, vUv.y)).rgb;\n  }\n\n  // rect6 (y+)\n  if (insideBox(vUv, vec2(rect6.x / dims.x, rect6.y / dims.y), vec2((rect6.x + rect6.z) / dims.x, (rect6.y + rect6.w) / dims.y)) >= 1.0) {\n    float offset = 1.0 / dims.y;\n    rgb = texture2D(buffer, vec2(vUv.x, vUv.y + offset)).rgb;\n  }\n\n  // rect7 (y-)\n  if (insideBox(vUv, vec2(rect7.x / dims.x, rect7.y / dims.y), vec2((rect7.x + rect7.z) / dims.x, (rect7.y + rect7.w) / dims.y)) >= 1.0) {\n    float offset = 1.0 / dims.y;\n    rgb = texture2D(buffer, vec2(vUv.x, vUv.y - offset)).rgb;\n  }\n\n  // rect8 (animate)\n  if (insideBox(vUv, vec2(rect8.x / dims.x, rect8.y / dims.y), vec2((rect8.x + rect8.z) / dims.x, (rect8.y + rect8.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect8.x;\n    float y = floor(vUv.y * dims.y) - rect8.y;\n    float step = mod(floor(time * 24.0), 16.0);\n\n    if (step == 0.0 && mod(y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x + 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x - 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 8.0 && mod(y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x - 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 8.0 && mod(y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x + 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n  }\n\n  // rect9 (animate)\n  if (insideBox(vUv, vec2(rect9.x / dims.x, rect9.y / dims.y), vec2((rect9.x + rect9.z) / dims.x, (rect9.y + rect9.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect9.x;\n    float y = floor(vUv.y * dims.y) - rect9.y;\n    float step = mod(floor(time * 60.0), 4.0);\n\n    if (step == 0.0 && mod(x, 2.0) == 0.0 && mod(y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x + 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(x, 2.0) == 1.0 && mod(y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x, vUv.y - 1.0 / dims.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(x, 2.0) == 1.0 && mod(y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x - 1.0 / dims.x, vUv.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(x, 2.0) == 0.0 && mod(y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x, vUv.y + 1.0 / dims.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n  }\n\n  // rect10 (animate)\n  if (insideBox(vUv, vec2(rect10.x / dims.x, rect10.y / dims.y), vec2((rect10.x + rect10.z) / dims.x, (rect10.y + rect10.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect10.x;\n    float y = floor(vUv.y * dims.y) - rect10.y;\n    float step = mod(floor(time * 60.0), 4.0);\n\n    if (step == 0.0 && mod(x + y, 2.0) == 0.0) {\n      vec2 pos = vec2(vUv.x + 1.0 / dims.x, vUv.y - 1.0 / dims.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n\n    if (step == 0.0 && mod(x + y, 2.0) == 1.0) {\n      vec2 pos = vec2(vUv.x - 1.0 / dims.x, vUv.y + 1.0 / dims.y);\n      rgb = texture2D(buffer, pos).rgb;\n    }\n  }\n\n  // rect11 (animate)\n  if (insideBox(vUv, vec2(rect11.x / dims.x, rect11.y / dims.y), vec2((rect11.x + rect11.z) / dims.x, (rect11.y + rect11.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect11.x;\n    float y = floor(vUv.y * dims.y) - rect11.y;\n\n    vec2 pos = vec2(vUv.x, vUv.y + sin(x * 0.1 + time * 2.0) / dims.y * 1.0);\n    rgb = texture2D(buffer, pos).rgb;\n  }\n\n  // rect12 (reset)\n  if (insideBox(vUv, vec2(rect12.x / dims.x, rect12.y / dims.y), vec2((rect12.x + rect12.z) / dims.x, (rect12.y + rect12.w) / dims.y)) >= 1.0) {\n    if (random(vec2(vUv.x + time, vUv.y)) < 0.06) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n  }\n\n  // rect13 (reset)\n  if (insideBox(vUv, vec2(rect13.x / dims.x, rect13.y / dims.y), vec2((rect13.x + rect13.z) / dims.x, (rect13.y + rect13.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect13.x;\n    float y = floor(vUv.y * dims.y) - rect13.y;\n\n    if (mod(x + y, 4.0) == mod(floor(time * 10.0), 4.0) && mod(y, 2.0) == 0.0) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n\n    if (mod(x + y + 1.0, 4.0) == mod(floor(time * 6.0), 4.0) && mod(y, 2.0) == 1.0) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n  }\n\n  // rect14 (reset)\n  if (insideBox(vUv, vec2(rect14.x / dims.x, rect14.y / dims.y), vec2((rect14.x + rect14.z) / dims.x, (rect14.y + rect14.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect14.x;\n    float y = floor(vUv.y * dims.y) - rect14.y;\n    float step = mod(floor(time * 50.0), 16.0);\n\n    if (mod(x, 16.0) == step) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n  }\n\n  // rect15 (reset)\n  if (insideBox(vUv, vec2(rect15.x / dims.x, rect15.y / dims.y), vec2((rect15.x + rect15.z) / dims.x, (rect15.y + rect15.w) / dims.y)) >= 1.0) {\n    float x = floor(vUv.x * dims.x) - rect15.x;\n    float y = floor(vUv.y * dims.y) - rect15.y;\n    float step = mod(floor(time * 50.0), 16.0);\n\n    if (mod(y, 16.0) == step) {\n      rgb = texture2D(tex, vUv).rgb;\n    }\n  }\n\n  vec4 color = vec4(rgb, 1.0);\n\n  gl_FragColor = color;\n}'])
          , R = n(["precision mediump float;\n#define GLSLIFY 1\n\nuniform sampler2D buffer;\n\nvarying vec2 vUv;\n\nvoid main() {\n  gl_FragColor = texture2D(buffer, vUv);\n}"]);
        t.exports = (s, e) => {
            let n = Math.min(window.devicePixelRatio, 2);
            var t = s.canvas;
            let c = v(t, {
                parent: e,
                scale: n
            }).on("tick", function(e) {
                a += e / 1e3,
                function(e) {
                    let t = f[l]
                      , r = f[l ^= 1];
                    r.bind(),
                    i.bind(),
                    i.uniforms.buffer = t.color[0].bind(0),
                    i.uniforms.tex = u.bind(1),
                    i.uniforms.dims = c.shape,
                    i.uniforms.time = e,
                    i.uniforms.rect0 = h[d[0]],
                    i.uniforms.rect1 = h[d[1]],
                    i.uniforms.rect2 = h[d[2]],
                    i.uniforms.rect3 = h[d[3]],
                    i.uniforms.rect4 = h[d[4]],
                    i.uniforms.rect5 = h[d[5]],
                    i.uniforms.rect6 = h[d[6]],
                    i.uniforms.rect7 = h[d[7]],
                    i.uniforms.rect8 = h[d[8]],
                    i.uniforms.rect9 = h[d[9]],
                    i.uniforms.rect10 = h[d[10]],
                    i.uniforms.rect11 = h[d[11]],
                    i.uniforms.rect12 = h[d[12]],
                    i.uniforms.rect13 = h[d[13]],
                    i.uniforms.rect14 = h[d[14]],
                    i.uniforms.rect15 = h[d[15]],
                    E(s)
                }(a);
                var [t,r] = c.shape;
                s.bindFramebuffer(s.FRAMEBUFFER, null),
                s.viewport(0, 0, t * n, r * n),
                o.bind(),
                o.uniforms.buffer = f[l].color[0].bind(),
                E(s)
            }).on("dispose", function() {
                i.dispose(),
                f[0].dispose(),
                f[1].dispose(),
                u.dispose();
                for (var e of p)
                    clearTimeout(e)
            }).on("resize", function() {
                for (var e of p)
                    clearTimeout(e);
                r()
            }), i = m(s, T, A), o = m(s, T, R), f, l = 0, u, h = [], d = [], p = [];
            const r = () => {
                let[n,e] = c.shape;
                f = [y(s, [n, e]), y(s, [n, e])],
                l = 0,
                f[0].color[0].magFilter = s.NEAREST,
                f[0].color[0].minFilter = s.NEAREST,
                f[1].color[0].magFilter = s.NEAREST,
                f[1].color[0].minFilter = s.NEAREST,
                u = _(s, [n, e]);
                var t = w(c.shape, {
                    logo: !0,
                    pixelSizeMin: 0,
                    pixelSizeMax: 0,
                    gapSizeMin: 2,
                    gapSizeMax: 4,
                    rectWidthMin: 10,
                    rectHeightMin: 10,
                    splitDepthVertical: .9,
                    splitDepthHorizontal: .9,
                    blackWhiteBalance: .1
                });
                let i = t.grid;
                var r = x(new Uint8Array(n * e * 4), [n, e, 4]);
                b(r, (e, t, r) => 3 === r ? 255 : 255 * i[e + t * n]),
                f[0].color[0].setPixels(r),
                u.setPixels(r),
                h = t.rects,
                d = [],
                p = [];
                let o = e => {
                    var t = Math.floor(5e3 * Math.random());
                    return setTimeout(function() {
                        d[e] = Math.floor(Math.random() * h.length),
                        o(e)
                    }, t)
                }
                ;
                for (let a = 0; a < 16; a++)
                    d.push(Math.floor(Math.random() * h.length)),
                    p[a] = o(a)
            }
            ;
            r(),
            i.attributes.position.location = 0,
            o.attributes.position.location = 0,
            s.disable(s.DEPTH_TEST);
            let a = 0;
            return c.start(),
            g(c, {
                canvas: t,
                gl: s
            })
        }
    }
    , {
        "./app": 4,
        "./grid-generator": 5,
        "a-big-triangle": 8,
        "gl-fbo": 27,
        "gl-shader": 31,
        "gl-texture2d": 38,
        glslify: 51,
        ndarray: 58,
        "ndarray-fill": 56,
        "object-assign": 59
    }],
    4: [function(e, t, r) {
        const a = e("canvas-fit")
          , s = e("raf-loop");
        t.exports = (r, e) => {
            if (!r)
                throw new TypeError("must specify a canvas element");
            e = e || {};
            const n = a(r, e.parent, e.scale)
              , i = s();
            let o = [0, 0];
            return t(),
            window.addEventListener("resize", t, !1),
            Object.defineProperties(i, {
                scale: {
                    get: function() {
                        return n.scale
                    },
                    set: function(e) {
                        n.scale = e
                    }
                },
                shape: {
                    get: function() {
                        return o
                    }
                },
                parent: {
                    get: function() {
                        return n.parent
                    },
                    set: function(e) {
                        n.parent = e
                    }
                }
            }),
            i.dispose = () => {
                i.stop(),
                window.removeEventListener("resize", t, !1),
                i.emit("dispose")
            }
            ,
            i;
            function t() {
                n();
                var e = r.width
                  , t = r.height;
                o[0] = Math.floor(e / n.scale),
                o[1] = Math.floor(t / n.scale),
                i.emit("resize")
            }
        }
    }
    , {
        "canvas-fit": 15,
        "raf-loop": 63
    }],
    5: [function(e, t, r) {
        let a = []
          , s = 0
          , f = []
          , l = {
            logo: !1,
            pixelSizeMin: 0,
            pixelSizeMax: 1,
            gapSizeMin: 1,
            gapSizeMax: 16,
            rectWidthMin: 16,
            rectHeightMin: 16,
            splitDepthVertical: .9,
            splitDepthHorizontal: .9,
            blackWhiteBalance: .5
        }
          , c = 1
          , u = 1;
        const h = (e, t, r, n) => {
            var i = [e, t, r, n];
            (r => {
                d();
                let n = 1
                  , i = 0;
                if (Math.random() < l.blackWhiteBalance) {
                    n = 0;
                    i = 1
                }
                for (let o = 0; o < r[3]; o++)
                    for (let t = 0; t < r[2]; t++) {
                        let e = t + r[0] + (o + r[1]) * s;
                        a[e] = t % (c + u) <= c && o % (c + u) <= c ? n : i
                    }
            }
            )(i),
            f.push(i)
        }
          , d = () => {
            c = Math.floor(Math.random() * (l.pixelSizeMax - l.pixelSizeMin)) + l.pixelSizeMin,
            u = Math.floor(Math.random() * (l.gapSizeMax - l.gapSizeMin)) + l.gapSizeMin
        }
          , n = e => {
            for (; 0 < f.length; ) {
                var t = Math.floor(Math.random() * f.length)
                  , r = f[t];
                n = e.length,
                c = s = a = o = i = void 0,
                o = r[0],
                a = r[1],
                s = r[2],
                c = r[3],
                Math.random() < .5 ? (((i = Math.floor(Math.random() * s)) >= l.rectWidthMin && Math.random() < l.splitDepthVertical || !n) && h(o, a, i, c),
                (s - i >= l.rectWidthMin && Math.random() < l.splitDepthVertical || !n) && h(o + i, a, s - i, c)) : (((i = Math.floor(Math.random() * c)) >= l.rectHeightMin && Math.random() < l.splitDepthHorizontal || !n) && h(o, a, s, i),
                (c - i >= l.rectHeightMin && Math.random() < l.splitDepthHorizontal || !n) && h(o, a + i, s, c - i));
                t = f.splice(t, 1);
                e.push(...t)
            }
            var n, i, o, a, s, c
        }
        ;
        t.exports = (e, t) => {
            l = t,
            a = new Array(e[0] * e[1]),
            a.fill(1),
            s = e[0],
            l.logo ? (h(0, 0, 20, 80),
            h(20, 60, 20, 20),
            h(40, 0, 20, 60),
            h(60, 60, 20, 20),
            h(80, 0, 20, 60),
            h(120, 0, 20, 80),
            h(140, 60, 40, 20),
            h(140, 0, 20, 20),
            h(160, 0, 20, 60),
            h(200, 60, 40, 20),
            h(200, 0, 20, 60),
            h(240, 0, 20, 60),
            h(280, 0, 20, 80),
            h(300, 60, 40, 20),
            h(300, 0, 20, 20),
            h(320, 0, 20, 60),
            h(360, 0, 20, 60),
            h(380, 60, 40, 20),
            h(380, 0, 40, 20),
            h(400, 20, 20, 20),
            h(440, 0, 20, 60),
            h(440, 60, 40, 20),
            h(480, 40, 20, 20),
            h(460, 20, 20, 20),
            h(480, 0, 20, 20),
            h(520, 0, 20, 80),
            h(560, 20, 20, 60),
            h(580, 60, 20, 20),
            h(600, 20, 20, 40),
            h(560, 0, 40, 20)) : h(0, 0, e[0], e[1]);
            var r = [];
            return n(r),
            r.length <= 1 && (h(0, 0, e[0], .5 * e[0]),
            n(r)),
            {
                grid: a,
                rects: r
            }
        }
    }
    , {}],
    6: [function(e, t, r) {
        let g = e("./grid-generator");
        let y = 0;
        t.exports = function(e, t) {
            var r = e.toString(16) + t.toString(16);
            let n = document.createElement("a");
            n.setAttribute("href", "/id/" + r),
            n.classList.add("item"),
            n.setAttribute("id", r);
            let i = document.createElement("div");
            i.classList.add("item-row"),
            n.appendChild(i);
            let o = document.createElement("div");
            o.classList.add("item-title"),
            o.innerText = r,
            i.appendChild(o);
            let a = document.createElement("canvas");
            a.classList.add("item-grid-canvas"),
            i.appendChild(a),
            ( (e, t, r) => {
                let n = e.getContext("2d");
                var i = window.devicePixelRatio;
                e.width = Math.floor(128 * i),
                e.height = Math.floor(64 * i),
                n.scale(i, i);
                var o = t < 8 ? 1 - 1 / 15 * r : 1 / 15 * r
                  , a = Math.floor(.5 * Math.max(1, t - 6))
                  , s = Math.max(0, t - 8) - a
                  , c = Math.max(1, t - 7) + a
                  , f = Math.floor(.5 * Math.max(1, 9 - t))
                  , l = Math.max(2, 9 - t) - f
                  , i = Math.max(3, 10 - t) + f
                  , a = 1 - .064 * (Math.abs(r - 7.5) - .5)
                  , f = 1 - .064 * (Math.abs(t - 7.5) - .5)
                  , u = g([128, 64], {
                    pixelSizeMin: s,
                    pixelSizeMax: c,
                    gapSizeMin: l,
                    gapSizeMax: i,
                    rectWidthMin: 16,
                    rectHeightMin: 16,
                    splitDepthVertical: f,
                    splitDepthHorizontal: a,
                    blackWhiteBalance: o
                }).grid;
                for (let h = 0; h < 64; h++)
                    for (let e = 0; e < 128; e++)
                        n.fillStyle = u[e + 128 * h] ? "#fff" : "#000",
                        n.fillRect(e, h, 1, 1)
            }
            )(a, e, t);
            let s = document.createElement("div");
            s.classList.add("item-row"),
            n.appendChild(s);
            var c = 8 - (Math.abs(t - 7.5) - .5)
              , f = 8 - (Math.abs(e - 7.5) - .5)
              , f = ( (e, t, r) => {
                switch (e) {
                case 1:
                    return 32 + (t == r ? 32 : 0) + (15 == Math.abs(t - r) ? 32 : 0);
                case 2:
                    return 48 + (t == r ? 32 : 0) + (13 == Math.abs(t - r) ? 32 : 0);
                case 3:
                    return 64 + (t == r ? 32 : 0) + (11 == Math.abs(t - r) ? 32 : 0);
                case 4:
                    return 80 + (t == r ? 32 : 0) + (9 == Math.abs(t - r) ? 32 : 0);
                case 5:
                    return 96 + (t == r ? 32 : 0) + (7 == Math.abs(t - r) ? 32 : 0);
                case 6:
                    return 112 + (t == r ? 32 : 0) + (5 == Math.abs(t - r) ? 32 : 0);
                case 7:
                    return 128 + (t == r ? 32 : 0) + (3 == Math.abs(t - r) ? 32 : 0);
                case 8:
                    return 144 + (t == r ? 32 : 0) + (1 == Math.abs(t - r) ? 32 : 0)
                }
            }
            )(Math.min(c, f), t, e);
            y += f;
            let l = document.createElement("div");
            l.classList.add("item-current-price"),
            l.innerHTML = f + "<br>tez",
            s.appendChild(l);
            let u = document.createElement("div");
            u.classList.add("item-last-price");
            let h = document.createElement("div");
            h.classList.add("label"),
            h.innerText = "0",
            u.appendChild(h);
            let d = document.createElement("div");
            d.classList.add("label"),
            d.innerText = "tez",
            u.appendChild(d),
            s.appendChild(u);
            let p = document.createElement("div");
            p.classList.add("item-row"),
            n.appendChild(p);
            let v = document.createElement("div");
            return v.classList.add("item-owner"),
            v.innerText = "monogrid",
            p.appendChild(v),
            {
                id: r,
                initialPrice: f,
                elements: {
                    item: n,
                    owner: v,
                    currentPrice: l,
                    lastPrice: u
                }
            }
        }
    }
    , {
        "./grid-generator": 5
    }],
    7: [function(e, t, r) {
        async function n(e, t, r) {
            const n = await fetch("https://data.objkt.com/v3/graphql", {
                method: "POST",
                body: JSON.stringify({
                    query: e,
                    variables: r,
                    operationName: t
                })
            });
            return n.json()
        }
        t.exports = {
            doFetchTokens: async function(e) {
                var {errors: t, data: r} = await n(`
  query tokens($address: String!) {
    token(where: {creators: {creator_address: {_eq: $address}}, supply: {_gt: 0}}, order_by: {token_id: desc}) {
      token_id
      artifact_uri
      display_uri
      thumbnail_uri
      name
      timestamp
      metadata
      lowest_ask
      listings_active {
        amount
        price_xtz
        seller {
          address
          alias
        }
      }
      listing_sales(order_by: {timestamp: asc}, limit: 1) {
        buyer {
          address
          alias
        }
        seller {
          address
          alias
        }
        price_xtz
        timestamp
      }
      holders(where: {quantity: {_gt: "0"}}) {
        holder {
          address
          alias
        }
      }
    }
  }
`, "tokens", {
                    address: e
                });
                if (t)
                    throw console.error(t),
                    t;
                return r.token
            },
            doFetchSales: async function() {
                var {errors: e, data: t} = await n(`
  query sales {
    listing(where: {token: {creators: {creator_address: {_eq: "tz1V7MkP1N5bBJasgDxyBvmGLxRBnjcwaNvG"}}}, status: {_eq: "concluded"}}, order_by: {timestamp: desc}) {
      status
      token {
        token_id
      }
      timestamp
      price_xtz
    }
    offer(where: {token: {creators: {creator_address: {_eq: "tz1V7MkP1N5bBJasgDxyBvmGLxRBnjcwaNvG"}}}, status: {_eq: "concluded"}}, order_by: {timestamp: desc}) {
      status
      token {
        token_id
      }
      timestamp
      price_xtz
    }
    english_auction(where: {token: {creators: {creator_address: {_eq: "tz1V7MkP1N5bBJasgDxyBvmGLxRBnjcwaNvG"}}}, status: {_eq: "concluded"}}, order_by: {timestamp: desc}) {
      status
      token {
        token_id
      }
      timestamp
      highest_bid_xtz
      end_time
    }
    dutch_auction(where: {token: {creators: {creator_address: {_eq: "tz1V7MkP1N5bBJasgDxyBvmGLxRBnjcwaNvG"}}}, status: {_eq: "concluded"}}, order_by: {timestamp: desc}) {
      status
      token {
        token_id
      }
      timestamp
      end_price
      end_time
    }
  }
`, "sales");
                if (e)
                    throw console.error(e),
                    e;
                return t
            }
        }
    }
    , {}],
    8: [function(e, t, r) {
        "use strict";
        var n = "undefined" == typeof WeakMap ? e("weak-map") : WeakMap
          , i = e("gl-buffer")
          , o = e("gl-vao")
          , a = new n;
        t.exports = function(e) {
            var t = a.get(e)
              , r = t && (t._triangleBuffer.handle || t._triangleBuffer.buffer);
            r && e.isBuffer(r) || (r = i(e, new Float32Array([-1, -1, -1, 4, 4, -1])),
            (t = o(e, [{
                buffer: r,
                type: e.FLOAT,
                size: 2
            }]))._triangleBuffer = r,
            a.set(e, t)),
            t.bind(),
            e.drawArrays(e.TRIANGLES, 0, 3),
            t.unbind()
        }
    }
    , {
        "gl-buffer": 24,
        "gl-vao": 42,
        "weak-map": 70
    }],
    9: [function(e, t, r) {
        var s = e("pad-left");
        t.exports = function(e, i, o) {
            i = "number" == typeof i ? i : 1,
            o = o || ": ";
            var t = e.split(/\r?\n/)
              , a = String(t.length + i - 1).length;
            return t.map(function(e, t) {
                var r = t + i
                  , n = String(r).length;
                return s(r, a - n) + o + e
            }).join("\n")
        }
    }
    , {
        "pad-left": 10
    }],
    10: [function(e, t, r) {
        "use strict";
        var n = e("repeat-string");
        t.exports = function(e, t, r) {
            return n(r = void 0 !== r ? r + "" : " ", t) + e
        }
    }
    , {
        "repeat-string": 65
    }],
    11: [function(e, t, r) {
        t.exports = function(e) {
            return atob(e)
        }
    }
    , {}],
    12: [function(e, t, r) {
        "use strict";
        r.byteLength = function(e) {
            var t = l(e)
              , r = t[0]
              , t = t[1];
            return 3 * (r + t) / 4 - t
        }
        ,
        r.toByteArray = function(e) {
            var t, r, n = l(e), i = n[0], n = n[1], o = new f(function(e, t) {
                return 3 * (e + t) / 4 - t
            }(i, n)), a = 0, s = 0 < n ? i - 4 : i;
            for (r = 0; r < s; r += 4)
                t = c[e.charCodeAt(r)] << 18 | c[e.charCodeAt(r + 1)] << 12 | c[e.charCodeAt(r + 2)] << 6 | c[e.charCodeAt(r + 3)],
                o[a++] = t >> 16 & 255,
                o[a++] = t >> 8 & 255,
                o[a++] = 255 & t;
            2 === n && (t = c[e.charCodeAt(r)] << 2 | c[e.charCodeAt(r + 1)] >> 4,
            o[a++] = 255 & t);
            1 === n && (t = c[e.charCodeAt(r)] << 10 | c[e.charCodeAt(r + 1)] << 4 | c[e.charCodeAt(r + 2)] >> 2,
            o[a++] = t >> 8 & 255,
            o[a++] = 255 & t);
            return o
        }
        ,
        r.fromByteArray = function(e) {
            for (var t, r = e.length, n = r % 3, i = [], o = 0, a = r - n; o < a; o += 16383)
                i.push(function(e, t, r) {
                    for (var n, i = [], o = t; o < r; o += 3)
                        n = (e[o] << 16 & 16711680) + (e[o + 1] << 8 & 65280) + (255 & e[o + 2]),
                        i.push(function(e) {
                            return s[e >> 18 & 63] + s[e >> 12 & 63] + s[e >> 6 & 63] + s[63 & e]
                        }(n));
                    return i.join("")
                }(e, o, a < o + 16383 ? a : o + 16383));
            1 == n ? (t = e[r - 1],
            i.push(s[t >> 2] + s[t << 4 & 63] + "==")) : 2 == n && (t = (e[r - 2] << 8) + e[r - 1],
            i.push(s[t >> 10] + s[t >> 4 & 63] + s[t << 2 & 63] + "="));
            return i.join("")
        }
        ;
        for (var s = [], c = [], f = "undefined" != typeof Uint8Array ? Uint8Array : Array, n = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", i = 0, o = n.length; i < o; ++i)
            s[i] = n[i],
            c[n.charCodeAt(i)] = i;
        function l(e) {
            var t = e.length;
            if (0 < t % 4)
                throw new Error("Invalid string. Length must be a multiple of 4");
            var r = e.indexOf("=");
            return [r = -1 === r ? t : r, r === t ? 0 : 4 - r % 4]
        }
        c["-".charCodeAt(0)] = 62,
        c["_".charCodeAt(0)] = 63
    }
    , {}],
    13: [function(e, t, r) {
        "use strict";
        function n(e) {
            var t = 32;
            return (e &= -e) && t--,
            65535 & e && (t -= 16),
            16711935 & e && (t -= 8),
            252645135 & e && (t -= 4),
            858993459 & e && (t -= 2),
            1431655765 & e && --t,
            t
        }
        r.INT_BITS = 32,
        r.INT_MAX = 2147483647,
        r.INT_MIN = -1 << 31,
        r.sign = function(e) {
            return (0 < e) - (e < 0)
        }
        ,
        r.abs = function(e) {
            var t = e >> 31;
            return (e ^ t) - t
        }
        ,
        r.min = function(e, t) {
            return t ^ (e ^ t) & -(e < t)
        }
        ,
        r.max = function(e, t) {
            return e ^ (e ^ t) & -(e < t)
        }
        ,
        r.isPow2 = function(e) {
            return !(e & e - 1 || !e)
        }
        ,
        r.log2 = function(e) {
            var t, r = (65535 < e) << 4;
            return r |= t = (255 < (e >>>= r)) << 3,
            r |= t = (15 < (e >>>= t)) << 2,
            (r |= t = (3 < (e >>>= t)) << 1) | (e >>>= t) >> 1
        }
        ,
        r.log10 = function(e) {
            return 1e9 <= e ? 9 : 1e8 <= e ? 8 : 1e7 <= e ? 7 : 1e6 <= e ? 6 : 1e5 <= e ? 5 : 1e4 <= e ? 4 : 1e3 <= e ? 3 : 100 <= e ? 2 : 10 <= e ? 1 : 0
        }
        ,
        r.popCount = function(e) {
            return 16843009 * ((e = (858993459 & (e -= e >>> 1 & 1431655765)) + (e >>> 2 & 858993459)) + (e >>> 4) & 252645135) >>> 24
        }
        ,
        r.countTrailingZeros = n,
        r.nextPow2 = function(e) {
            return e += 0 === e,
            --e,
            e |= e >>> 1,
            e |= e >>> 2,
            e |= e >>> 4,
            e |= e >>> 8,
            (e |= e >>> 16) + 1
        }
        ,
        r.prevPow2 = function(e) {
            return e |= e >>> 1,
            e |= e >>> 2,
            e |= e >>> 4,
            e |= e >>> 8,
            (e |= e >>> 16) - (e >>> 1)
        }
        ,
        r.parity = function(e) {
            return e ^= e >>> 16,
            e ^= e >>> 8,
            e ^= e >>> 4,
            27030 >>> (e &= 15) & 1
        }
        ;
        var i = new Array(256);
        !function(e) {
            for (var t = 0; t < 256; ++t) {
                var r = t
                  , n = t
                  , i = 7;
                for (r >>>= 1; r; r >>>= 1)
                    n <<= 1,
                    n |= 1 & r,
                    --i;
                e[t] = n << i & 255
            }
        }(i),
        r.reverse = function(e) {
            return i[255 & e] << 24 | i[e >>> 8 & 255] << 16 | i[e >>> 16 & 255] << 8 | i[e >>> 24 & 255]
        }
        ,
        r.interleave2 = function(e, t) {
            return (e = 1431655765 & ((e = 858993459 & ((e = 252645135 & ((e = 16711935 & ((e &= 65535) | e << 8)) | e << 4)) | e << 2)) | e << 1)) | (t = 1431655765 & ((t = 858993459 & ((t = 252645135 & ((t = 16711935 & ((t &= 65535) | t << 8)) | t << 4)) | t << 2)) | t << 1)) << 1
        }
        ,
        r.deinterleave2 = function(e, t) {
            return (e = 65535 & ((e = 16711935 & ((e = 252645135 & ((e = 858993459 & ((e = e >>> t & 1431655765) | e >>> 1)) | e >>> 2)) | e >>> 4)) | e >>> 16)) << 16 >> 16
        }
        ,
        r.interleave3 = function(e, t, r) {
            return e = 1227133513 & ((e = 3272356035 & ((e = 251719695 & ((e = 4278190335 & ((e &= 1023) | e << 16)) | e << 8)) | e << 4)) | e << 2),
            (e |= (t = 1227133513 & ((t = 3272356035 & ((t = 251719695 & ((t = 4278190335 & ((t &= 1023) | t << 16)) | t << 8)) | t << 4)) | t << 2)) << 1) | (r = 1227133513 & ((r = 3272356035 & ((r = 251719695 & ((r = 4278190335 & ((r &= 1023) | r << 16)) | r << 8)) | r << 4)) | r << 2)) << 2
        }
        ,
        r.deinterleave3 = function(e, t) {
            return (e = 1023 & ((e = 4278190335 & ((e = 251719695 & ((e = 3272356035 & ((e = e >>> t & 1227133513) | e >>> 2)) | e >>> 4)) | e >>> 8)) | e >>> 16)) << 22 >> 22
        }
        ,
        r.nextCombination = function(e) {
            var t = e | e - 1;
            return 1 + t | (~t & -~t) - 1 >>> n(e) + 1
        }
    }
    , {}],
    14: [function(N, e, M) {
        !(function(e) {
            !(function() {
                "use strict";
                var s = N("base64-js")
                  , o = N("ieee754");
                M.Buffer = u,
                M.SlowBuffer = function(e) {
                    +e != e && (e = 0);
                    return u.alloc(+e)
                }
                ,
                M.INSPECT_MAX_BYTES = 50;
                var r = 2147483647;
                function a(e) {
                    if (r < e)
                        throw new RangeError('The value "' + e + '" is invalid for option "size"');
                    var t = new Uint8Array(e);
                    return t.__proto__ = u.prototype,
                    t
                }
                function u(e, t, r) {
                    if ("number" != typeof e)
                        return n(e, t, r);
                    if ("string" == typeof t)
                        throw new TypeError('The "string" argument must be of type string. Received type number');
                    return c(e)
                }
                function n(e, t, r) {
                    if ("string" == typeof e)
                        return function(e, t) {
                            "string" == typeof t && "" !== t || (t = "utf8");
                            if (!u.isEncoding(t))
                                throw new TypeError("Unknown encoding: " + t);
                            var r = 0 | h(e, t)
                              , n = a(r)
                              , i = n.write(e, t);
                            i !== r && (n = n.slice(0, i));
                            return n
                        }(e, t);
                    if (ArrayBuffer.isView(e))
                        return f(e);
                    if (null == e)
                        throw TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof e);
                    if (P(e, ArrayBuffer) || e && P(e.buffer, ArrayBuffer))
                        return function(e, t, r) {
                            if (t < 0 || e.byteLength < t)
                                throw new RangeError('"offset" is outside of buffer bounds');
                            if (e.byteLength < t + (r || 0))
                                throw new RangeError('"length" is outside of buffer bounds');
                            var n;
                            n = void 0 === t && void 0 === r ? new Uint8Array(e) : void 0 === r ? new Uint8Array(e,t) : new Uint8Array(e,t,r);
                            return n.__proto__ = u.prototype,
                            n
                        }(e, t, r);
                    if ("number" == typeof e)
                        throw new TypeError('The "value" argument must not be of type number. Received type number');
                    var n = e.valueOf && e.valueOf();
                    if (null != n && n !== e)
                        return u.from(n, t, r);
                    n = function(e) {
                        if (u.isBuffer(e)) {
                            var t = 0 | l(e.length)
                              , r = a(t);
                            return 0 === r.length ? r : (e.copy(r, 0, 0, t),
                            r)
                        }
                        if (void 0 !== e.length)
                            return "number" != typeof e.length || S(e.length) ? a(0) : f(e);
                        if ("Buffer" === e.type && Array.isArray(e.data))
                            return f(e.data)
                    }(e);
                    if (n)
                        return n;
                    if ("undefined" != typeof Symbol && null != Symbol.toPrimitive && "function" == typeof e[Symbol.toPrimitive])
                        return u.from(e[Symbol.toPrimitive]("string"), t, r);
                    throw new TypeError("The first argument must be one of type string, Buffer, ArrayBuffer, Array, or Array-like Object. Received type " + typeof e)
                }
                function i(e) {
                    if ("number" != typeof e)
                        throw new TypeError('"size" argument must be of type number');
                    if (e < 0)
                        throw new RangeError('The value "' + e + '" is invalid for option "size"')
                }
                function c(e) {
                    return i(e),
                    a(e < 0 ? 0 : 0 | l(e))
                }
                function f(e) {
                    for (var t = e.length < 0 ? 0 : 0 | l(e.length), r = a(t), n = 0; n < t; n += 1)
                        r[n] = 255 & e[n];
                    return r
                }
                function l(e) {
                    if (r <= e)
                        throw new RangeError("Attempt to allocate Buffer larger than maximum size: 0x" + r.toString(16) + " bytes");
                    return 0 | e
                }
                function h(e, t) {
                    if (u.isBuffer(e))
                        return e.length;
                    if (ArrayBuffer.isView(e) || P(e, ArrayBuffer))
                        return e.byteLength;
                    if ("string" != typeof e)
                        throw new TypeError('The "string" argument must be one of type string, Buffer, or ArrayBuffer. Received type ' + typeof e);
                    var r = e.length
                      , n = 2 < arguments.length && !0 === arguments[2];
                    if (!n && 0 === r)
                        return 0;
                    for (var i = !1; ; )
                        switch (t) {
                        case "ascii":
                        case "latin1":
                        case "binary":
                            return r;
                        case "utf8":
                        case "utf-8":
                            return R(e).length;
                        case "ucs2":
                        case "ucs-2":
                        case "utf16le":
                        case "utf-16le":
                            return 2 * r;
                        case "hex":
                            return r >>> 1;
                        case "base64":
                            return I(e).length;
                        default:
                            if (i)
                                return n ? -1 : R(e).length;
                            t = ("" + t).toLowerCase(),
                            i = !0
                        }
                }
                function t(e, t, r) {
                    var n, i, o, a = !1;
                    if ((t = void 0 === t || t < 0 ? 0 : t) > this.length)
                        return "";
                    if ((r = void 0 === r || r > this.length ? this.length : r) <= 0)
                        return "";
                    if ((r >>>= 0) <= (t >>>= 0))
                        return "";
                    for (e = e || "utf8"; ; )
                        switch (e) {
                        case "hex":
                            return function(e, t, r) {
                                var n = e.length;
                                (!t || t < 0) && (t = 0);
                                (!r || r < 0 || n < r) && (r = n);
                                for (var i = "", o = t; o < r; ++o)
                                    i += function(e) {
                                        return e < 16 ? "0" + e.toString(16) : e.toString(16)
                                    }(e[o]);
                                return i
                            }(this, t, r);
                        case "utf8":
                        case "utf-8":
                            return m(this, t, r);
                        case "ascii":
                            return function(e, t, r) {
                                var n = "";
                                r = Math.min(e.length, r);
                                for (var i = t; i < r; ++i)
                                    n += String.fromCharCode(127 & e[i]);
                                return n
                            }(this, t, r);
                        case "latin1":
                        case "binary":
                            return function(e, t, r) {
                                var n = "";
                                r = Math.min(e.length, r);
                                for (var i = t; i < r; ++i)
                                    n += String.fromCharCode(e[i]);
                                return n
                            }(this, t, r);
                        case "base64":
                            return n = this,
                            o = r,
                            0 === (i = t) && o === n.length ? s.fromByteArray(n) : s.fromByteArray(n.slice(i, o));
                        case "ucs2":
                        case "ucs-2":
                        case "utf16le":
                        case "utf-16le":
                            return function(e, t, r) {
                                for (var n = e.slice(t, r), i = "", o = 0; o < n.length; o += 2)
                                    i += String.fromCharCode(n[o] + 256 * n[o + 1]);
                                return i
                            }(this, t, r);
                        default:
                            if (a)
                                throw new TypeError("Unknown encoding: " + e);
                            e = (e + "").toLowerCase(),
                            a = !0
                        }
                }
                function d(e, t, r) {
                    var n = e[t];
                    e[t] = e[r],
                    e[r] = n
                }
                function p(e, t, r, n, i) {
                    if (0 === e.length)
                        return -1;
                    if ("string" == typeof r ? (n = r,
                    r = 0) : 2147483647 < r ? r = 2147483647 : r < -2147483648 && (r = -2147483648),
                    (r = (r = S(r = +r) ? i ? 0 : e.length - 1 : r) < 0 ? e.length + r : r) >= e.length) {
                        if (i)
                            return -1;
                        r = e.length - 1
                    } else if (r < 0) {
                        if (!i)
                            return -1;
                        r = 0
                    }
                    if ("string" == typeof t && (t = u.from(t, n)),
                    u.isBuffer(t))
                        return 0 === t.length ? -1 : v(e, t, r, n, i);
                    if ("number" == typeof t)
                        return t &= 255,
                        "function" == typeof Uint8Array.prototype.indexOf ? (i ? Uint8Array.prototype.indexOf : Uint8Array.prototype.lastIndexOf).call(e, t, r) : v(e, [t], r, n, i);
                    throw new TypeError("val must be string, number or Buffer")
                }
                function v(e, t, r, n, i) {
                    var o = 1
                      , a = e.length
                      , s = t.length;
                    if (void 0 !== n && ("ucs2" === (n = String(n).toLowerCase()) || "ucs-2" === n || "utf16le" === n || "utf-16le" === n)) {
                        if (e.length < 2 || t.length < 2)
                            return -1;
                        a /= o = 2,
                        s /= 2,
                        r /= 2
                    }
                    function c(e, t) {
                        return 1 === o ? e[t] : e.readUInt16BE(t * o)
                    }
                    if (i)
                        for (var f = -1, l = r; l < a; l++)
                            if (c(e, l) === c(t, -1 === f ? 0 : l - f)) {
                                if (l - (f = -1 === f ? l : f) + 1 === s)
                                    return f * o
                            } else
                                -1 !== f && (l -= l - f),
                                f = -1;
                    else
                        for (l = r = a < r + s ? a - s : r; 0 <= l; l--) {
                            for (var u = !0, h = 0; h < s; h++)
                                if (c(e, l + h) !== c(t, h)) {
                                    u = !1;
                                    break
                                }
                            if (u)
                                return l
                        }
                    return -1
                }
                function g(e, t, r, n) {
                    return U(function(e) {
                        for (var t = [], r = 0; r < e.length; ++r)
                            t.push(255 & e.charCodeAt(r));
                        return t
                    }(t), e, r, n)
                }
                function y(e, t, r, n) {
                    return U(function(e, t) {
                        for (var r, n, i = [], o = 0; o < e.length && !((t -= 2) < 0); ++o)
                            n = e.charCodeAt(o),
                            r = n >> 8,
                            n = n % 256,
                            i.push(n),
                            i.push(r);
                        return i
                    }(t, e.length - r), e, r, n)
                }
                function m(e, t, r) {
                    r = Math.min(e.length, r);
                    for (var n = [], i = t; i < r; ) {
                        var o, a, s, c, f = e[i], l = null, u = 239 < f ? 4 : 223 < f ? 3 : 191 < f ? 2 : 1;
                        if (i + u <= r)
                            switch (u) {
                            case 1:
                                f < 128 && (l = f);
                                break;
                            case 2:
                                128 == (192 & (o = e[i + 1])) && 127 < (c = (31 & f) << 6 | 63 & o) && (l = c);
                                break;
                            case 3:
                                o = e[i + 1],
                                a = e[i + 2],
                                128 == (192 & o) && 128 == (192 & a) && 2047 < (c = (15 & f) << 12 | (63 & o) << 6 | 63 & a) && (c < 55296 || 57343 < c) && (l = c);
                                break;
                            case 4:
                                o = e[i + 1],
                                a = e[i + 2],
                                s = e[i + 3],
                                128 == (192 & o) && 128 == (192 & a) && 128 == (192 & s) && 65535 < (c = (15 & f) << 18 | (63 & o) << 12 | (63 & a) << 6 | 63 & s) && c < 1114112 && (l = c)
                            }
                        null === l ? (l = 65533,
                        u = 1) : 65535 < l && (l -= 65536,
                        n.push(l >>> 10 & 1023 | 55296),
                        l = 56320 | 1023 & l),
                        n.push(l),
                        i += u
                    }
                    return function(e) {
                        var t = e.length;
                        if (t <= _)
                            return String.fromCharCode.apply(String, e);
                        var r = ""
                          , n = 0;
                        for (; n < t; )
                            r += String.fromCharCode.apply(String, e.slice(n, n += _));
                        return r
                    }(n)
                }
                M.kMaxLength = r,
                (u.TYPED_ARRAY_SUPPORT = function() {
                    try {
                        var e = new Uint8Array(1);
                        return e.__proto__ = {
                            __proto__: Uint8Array.prototype,
                            foo: function() {
                                return 42
                            }
                        },
                        42 === e.foo()
                    } catch (e) {
                        return !1
                    }
                }()) || "undefined" == typeof console || "function" != typeof console.error || console.error("This browser lacks typed array (Uint8Array) support which is required by `buffer` v5.x. Use `buffer` v4.x if you require old browser support."),
                Object.defineProperty(u.prototype, "parent", {
                    enumerable: !0,
                    get: function() {
                        if (u.isBuffer(this))
                            return this.buffer
                    }
                }),
                Object.defineProperty(u.prototype, "offset", {
                    enumerable: !0,
                    get: function() {
                        if (u.isBuffer(this))
                            return this.byteOffset
                    }
                }),
                "undefined" != typeof Symbol && null != Symbol.species && u[Symbol.species] === u && Object.defineProperty(u, Symbol.species, {
                    value: null,
                    configurable: !0,
                    enumerable: !1,
                    writable: !1
                }),
                u.poolSize = 8192,
                u.from = n,
                u.prototype.__proto__ = Uint8Array.prototype,
                u.__proto__ = Uint8Array,
                u.alloc = function(e, t, r) {
                    return t = t,
                    r = r,
                    i(e = e),
                    !(e <= 0) && void 0 !== t ? "string" == typeof r ? a(e).fill(t, r) : a(e).fill(t) : a(e)
                }
                ,
                u.allocUnsafe = c,
                u.allocUnsafeSlow = c,
                u.isBuffer = function(e) {
                    return null != e && !0 === e._isBuffer && e !== u.prototype
                }
                ,
                u.compare = function(e, t) {
                    if (P(e, Uint8Array) && (e = u.from(e, e.offset, e.byteLength)),
                    P(t, Uint8Array) && (t = u.from(t, t.offset, t.byteLength)),
                    !u.isBuffer(e) || !u.isBuffer(t))
                        throw new TypeError('The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array');
                    if (e === t)
                        return 0;
                    for (var r = e.length, n = t.length, i = 0, o = Math.min(r, n); i < o; ++i)
                        if (e[i] !== t[i]) {
                            r = e[i],
                            n = t[i];
                            break
                        }
                    return r < n ? -1 : n < r ? 1 : 0
                }
                ,
                u.isEncoding = function(e) {
                    switch (String(e).toLowerCase()) {
                    case "hex":
                    case "utf8":
                    case "utf-8":
                    case "ascii":
                    case "latin1":
                    case "binary":
                    case "base64":
                    case "ucs2":
                    case "ucs-2":
                    case "utf16le":
                    case "utf-16le":
                        return !0;
                    default:
                        return !1
                    }
                }
                ,
                u.concat = function(e, t) {
                    if (!Array.isArray(e))
                        throw new TypeError('"list" argument must be an Array of Buffers');
                    if (0 === e.length)
                        return u.alloc(0);
                    if (void 0 === t)
                        for (i = t = 0; i < e.length; ++i)
                            t += e[i].length;
                    for (var r = u.allocUnsafe(t), n = 0, i = 0; i < e.length; ++i) {
                        var o = e[i];
                        if (P(o, Uint8Array) && (o = u.from(o)),
                        !u.isBuffer(o))
                            throw new TypeError('"list" argument must be an Array of Buffers');
                        o.copy(r, n),
                        n += o.length
                    }
                    return r
                }
                ,
                u.byteLength = h,
                u.prototype._isBuffer = !0,
                u.prototype.swap16 = function() {
                    var e = this.length;
                    if (e % 2 != 0)
                        throw new RangeError("Buffer size must be a multiple of 16-bits");
                    for (var t = 0; t < e; t += 2)
                        d(this, t, t + 1);
                    return this
                }
                ,
                u.prototype.swap32 = function() {
                    var e = this.length;
                    if (e % 4 != 0)
                        throw new RangeError("Buffer size must be a multiple of 32-bits");
                    for (var t = 0; t < e; t += 4)
                        d(this, t, t + 3),
                        d(this, t + 1, t + 2);
                    return this
                }
                ,
                u.prototype.swap64 = function() {
                    var e = this.length;
                    if (e % 8 != 0)
                        throw new RangeError("Buffer size must be a multiple of 64-bits");
                    for (var t = 0; t < e; t += 8)
                        d(this, t, t + 7),
                        d(this, t + 1, t + 6),
                        d(this, t + 2, t + 5),
                        d(this, t + 3, t + 4);
                    return this
                }
                ,
                u.prototype.toLocaleString = u.prototype.toString = function() {
                    var e = this.length;
                    return 0 === e ? "" : 0 === arguments.length ? m(this, 0, e) : t.apply(this, arguments)
                }
                ,
                u.prototype.equals = function(e) {
                    if (!u.isBuffer(e))
                        throw new TypeError("Argument must be a Buffer");
                    return this === e || 0 === u.compare(this, e)
                }
                ,
                u.prototype.inspect = function() {
                    var e = ""
                      , t = M.INSPECT_MAX_BYTES
                      , e = this.toString("hex", 0, t).replace(/(.{2})/g, "$1 ").trim();
                    return this.length > t && (e += " ... "),
                    "<Buffer " + e + ">"
                }
                ,
                u.prototype.compare = function(e, t, r, n, i) {
                    if (P(e, Uint8Array) && (e = u.from(e, e.offset, e.byteLength)),
                    !u.isBuffer(e))
                        throw new TypeError('The "target" argument must be one of type Buffer or Uint8Array. Received type ' + typeof e);
                    if (void 0 === r && (r = e ? e.length : 0),
                    void 0 === n && (n = 0),
                    void 0 === i && (i = this.length),
                    (t = void 0 === t ? 0 : t) < 0 || r > e.length || n < 0 || i > this.length)
                        throw new RangeError("out of range index");
                    if (i <= n && r <= t)
                        return 0;
                    if (i <= n)
                        return -1;
                    if (r <= t)
                        return 1;
                    if (this === e)
                        return 0;
                    for (var o = (i >>>= 0) - (n >>>= 0), a = (r >>>= 0) - (t >>>= 0), s = Math.min(o, a), c = this.slice(n, i), f = e.slice(t, r), l = 0; l < s; ++l)
                        if (c[l] !== f[l]) {
                            o = c[l],
                            a = f[l];
                            break
                        }
                    return o < a ? -1 : a < o ? 1 : 0
                }
                ,
                u.prototype.includes = function(e, t, r) {
                    return -1 !== this.indexOf(e, t, r)
                }
                ,
                u.prototype.indexOf = function(e, t, r) {
                    return p(this, e, t, r, !0)
                }
                ,
                u.prototype.lastIndexOf = function(e, t, r) {
                    return p(this, e, t, r, !1)
                }
                ,
                u.prototype.write = function(e, t, r, n) {
                    if (void 0 === t)
                        n = "utf8",
                        r = this.length,
                        t = 0;
                    else if (void 0 === r && "string" == typeof t)
                        n = t,
                        r = this.length,
                        t = 0;
                    else {
                        if (!isFinite(t))
                            throw new Error("Buffer.write(string, encoding, offset[, length]) is no longer supported");
                        t >>>= 0,
                        isFinite(r) ? (r >>>= 0,
                        void 0 === n && (n = "utf8")) : (n = r,
                        r = void 0)
                    }
                    var i = this.length - t;
                    if ((void 0 === r || i < r) && (r = i),
                    0 < e.length && (r < 0 || t < 0) || t > this.length)
                        throw new RangeError("Attempt to write outside buffer bounds");
                    n = n || "utf8";
                    for (var o, a, s, c = !1; ; )
                        switch (n) {
                        case "hex":
                            return function(e, t, r, n) {
                                r = Number(r) || 0;
                                var i = e.length - r;
                                (!n || i < (n = Number(n))) && (n = i),
                                (i = t.length) / 2 < n && (n = i / 2);
                                for (var o = 0; o < n; ++o) {
                                    var a = parseInt(t.substr(2 * o, 2), 16);
                                    if (S(a))
                                        return o;
                                    e[r + o] = a
                                }
                                return o
                            }(this, e, t, r);
                        case "utf8":
                        case "utf-8":
                            return a = t,
                            s = r,
                            U(R(e, (o = this).length - a), o, a, s);
                        case "ascii":
                            return g(this, e, t, r);
                        case "latin1":
                        case "binary":
                            return g(this, e, t, r);
                        case "base64":
                            return o = this,
                            a = t,
                            s = r,
                            U(I(e), o, a, s);
                        case "ucs2":
                        case "ucs-2":
                        case "utf16le":
                        case "utf-16le":
                            return y(this, e, t, r);
                        default:
                            if (c)
                                throw new TypeError("Unknown encoding: " + n);
                            n = ("" + n).toLowerCase(),
                            c = !0
                        }
                }
                ,
                u.prototype.toJSON = function() {
                    return {
                        type: "Buffer",
                        data: Array.prototype.slice.call(this._arr || this, 0)
                    }
                }
                ;
                var _ = 4096;
                function x(e, t, r) {
                    if (e % 1 != 0 || e < 0)
                        throw new RangeError("offset is not uint");
                    if (r < e + t)
                        throw new RangeError("Trying to access beyond buffer length")
                }
                function b(e, t, r, n, i, o) {
                    if (!u.isBuffer(e))
                        throw new TypeError('"buffer" argument must be a Buffer instance');
                    if (i < t || t < o)
                        throw new RangeError('"value" argument is out of bounds');
                    if (r + n > e.length)
                        throw new RangeError("Index out of range")
                }
                function E(e, t, r, n) {
                    if (r + n > e.length)
                        throw new RangeError("Index out of range");
                    if (r < 0)
                        throw new RangeError("Index out of range")
                }
                function w(e, t, r, n, i) {
                    return t = +t,
                    r >>>= 0,
                    i || E(e, 0, r, 4),
                    o.write(e, t, r, n, 23, 4),
                    r + 4
                }
                function T(e, t, r, n, i) {
                    return t = +t,
                    r >>>= 0,
                    i || E(e, 0, r, 8),
                    o.write(e, t, r, n, 52, 8),
                    r + 8
                }
                u.prototype.slice = function(e, t) {
                    var r = this.length;
                    (e = ~~e) < 0 ? (e += r) < 0 && (e = 0) : r < e && (e = r),
                    (t = void 0 === t ? r : ~~t) < 0 ? (t += r) < 0 && (t = 0) : r < t && (t = r),
                    t < e && (t = e);
                    r = this.subarray(e, t);
                    return r.__proto__ = u.prototype,
                    r
                }
                ,
                u.prototype.readUIntLE = function(e, t, r) {
                    e >>>= 0,
                    t >>>= 0,
                    r || x(e, t, this.length);
                    for (var n = this[e], i = 1, o = 0; ++o < t && (i *= 256); )
                        n += this[e + o] * i;
                    return n
                }
                ,
                u.prototype.readUIntBE = function(e, t, r) {
                    e >>>= 0,
                    t >>>= 0,
                    r || x(e, t, this.length);
                    for (var n = this[e + --t], i = 1; 0 < t && (i *= 256); )
                        n += this[e + --t] * i;
                    return n
                }
                ,
                u.prototype.readUInt8 = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 1, this.length),
                    this[e]
                }
                ,
                u.prototype.readUInt16LE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 2, this.length),
                    this[e] | this[e + 1] << 8
                }
                ,
                u.prototype.readUInt16BE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 2, this.length),
                    this[e] << 8 | this[e + 1]
                }
                ,
                u.prototype.readUInt32LE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 4, this.length),
                    (this[e] | this[e + 1] << 8 | this[e + 2] << 16) + 16777216 * this[e + 3]
                }
                ,
                u.prototype.readUInt32BE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 4, this.length),
                    16777216 * this[e] + (this[e + 1] << 16 | this[e + 2] << 8 | this[e + 3])
                }
                ,
                u.prototype.readIntLE = function(e, t, r) {
                    e >>>= 0,
                    t >>>= 0,
                    r || x(e, t, this.length);
                    for (var n = this[e], i = 1, o = 0; ++o < t && (i *= 256); )
                        n += this[e + o] * i;
                    return (i *= 128) <= n && (n -= Math.pow(2, 8 * t)),
                    n
                }
                ,
                u.prototype.readIntBE = function(e, t, r) {
                    e >>>= 0,
                    t >>>= 0,
                    r || x(e, t, this.length);
                    for (var n = t, i = 1, o = this[e + --n]; 0 < n && (i *= 256); )
                        o += this[e + --n] * i;
                    return (i *= 128) <= o && (o -= Math.pow(2, 8 * t)),
                    o
                }
                ,
                u.prototype.readInt8 = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 1, this.length),
                    128 & this[e] ? -1 * (255 - this[e] + 1) : this[e]
                }
                ,
                u.prototype.readInt16LE = function(e, t) {
                    e >>>= 0,
                    t || x(e, 2, this.length);
                    var r = this[e] | this[e + 1] << 8;
                    return 32768 & r ? 4294901760 | r : r
                }
                ,
                u.prototype.readInt16BE = function(e, t) {
                    e >>>= 0,
                    t || x(e, 2, this.length);
                    var r = this[e + 1] | this[e] << 8;
                    return 32768 & r ? 4294901760 | r : r
                }
                ,
                u.prototype.readInt32LE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 4, this.length),
                    this[e] | this[e + 1] << 8 | this[e + 2] << 16 | this[e + 3] << 24
                }
                ,
                u.prototype.readInt32BE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 4, this.length),
                    this[e] << 24 | this[e + 1] << 16 | this[e + 2] << 8 | this[e + 3]
                }
                ,
                u.prototype.readFloatLE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 4, this.length),
                    o.read(this, e, !0, 23, 4)
                }
                ,
                u.prototype.readFloatBE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 4, this.length),
                    o.read(this, e, !1, 23, 4)
                }
                ,
                u.prototype.readDoubleLE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 8, this.length),
                    o.read(this, e, !0, 52, 8)
                }
                ,
                u.prototype.readDoubleBE = function(e, t) {
                    return e >>>= 0,
                    t || x(e, 8, this.length),
                    o.read(this, e, !1, 52, 8)
                }
                ,
                u.prototype.writeUIntLE = function(e, t, r, n) {
                    e = +e,
                    t >>>= 0,
                    r >>>= 0,
                    n || b(this, e, t, r, Math.pow(2, 8 * r) - 1, 0);
                    var i = 1
                      , o = 0;
                    for (this[t] = 255 & e; ++o < r && (i *= 256); )
                        this[t + o] = e / i & 255;
                    return t + r
                }
                ,
                u.prototype.writeUIntBE = function(e, t, r, n) {
                    e = +e,
                    t >>>= 0,
                    r >>>= 0,
                    n || b(this, e, t, r, Math.pow(2, 8 * r) - 1, 0);
                    var i = r - 1
                      , o = 1;
                    for (this[t + i] = 255 & e; 0 <= --i && (o *= 256); )
                        this[t + i] = e / o & 255;
                    return t + r
                }
                ,
                u.prototype.writeUInt8 = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 1, 255, 0),
                    this[t] = 255 & e,
                    t + 1
                }
                ,
                u.prototype.writeUInt16LE = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 2, 65535, 0),
                    this[t] = 255 & e,
                    this[t + 1] = e >>> 8,
                    t + 2
                }
                ,
                u.prototype.writeUInt16BE = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 2, 65535, 0),
                    this[t] = e >>> 8,
                    this[t + 1] = 255 & e,
                    t + 2
                }
                ,
                u.prototype.writeUInt32LE = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 4, 4294967295, 0),
                    this[t + 3] = e >>> 24,
                    this[t + 2] = e >>> 16,
                    this[t + 1] = e >>> 8,
                    this[t] = 255 & e,
                    t + 4
                }
                ,
                u.prototype.writeUInt32BE = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 4, 4294967295, 0),
                    this[t] = e >>> 24,
                    this[t + 1] = e >>> 16,
                    this[t + 2] = e >>> 8,
                    this[t + 3] = 255 & e,
                    t + 4
                }
                ,
                u.prototype.writeIntLE = function(e, t, r, n) {
                    var i;
                    e = +e,
                    t >>>= 0,
                    n || b(this, e, t, r, (i = Math.pow(2, 8 * r - 1)) - 1, -i);
                    var o = 0
                      , a = 1
                      , s = 0;
                    for (this[t] = 255 & e; ++o < r && (a *= 256); )
                        e < 0 && 0 === s && 0 !== this[t + o - 1] && (s = 1),
                        this[t + o] = (e / a >> 0) - s & 255;
                    return t + r
                }
                ,
                u.prototype.writeIntBE = function(e, t, r, n) {
                    var i;
                    e = +e,
                    t >>>= 0,
                    n || b(this, e, t, r, (i = Math.pow(2, 8 * r - 1)) - 1, -i);
                    var o = r - 1
                      , a = 1
                      , s = 0;
                    for (this[t + o] = 255 & e; 0 <= --o && (a *= 256); )
                        e < 0 && 0 === s && 0 !== this[t + o + 1] && (s = 1),
                        this[t + o] = (e / a >> 0) - s & 255;
                    return t + r
                }
                ,
                u.prototype.writeInt8 = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 1, 127, -128),
                    this[t] = 255 & (e = e < 0 ? 255 + e + 1 : e),
                    t + 1
                }
                ,
                u.prototype.writeInt16LE = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 2, 32767, -32768),
                    this[t] = 255 & e,
                    this[t + 1] = e >>> 8,
                    t + 2
                }
                ,
                u.prototype.writeInt16BE = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 2, 32767, -32768),
                    this[t] = e >>> 8,
                    this[t + 1] = 255 & e,
                    t + 2
                }
                ,
                u.prototype.writeInt32LE = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 4, 2147483647, -2147483648),
                    this[t] = 255 & e,
                    this[t + 1] = e >>> 8,
                    this[t + 2] = e >>> 16,
                    this[t + 3] = e >>> 24,
                    t + 4
                }
                ,
                u.prototype.writeInt32BE = function(e, t, r) {
                    return e = +e,
                    t >>>= 0,
                    r || b(this, e, t, 4, 2147483647, -2147483648),
                    this[t] = (e = e < 0 ? 4294967295 + e + 1 : e) >>> 24,
                    this[t + 1] = e >>> 16,
                    this[t + 2] = e >>> 8,
                    this[t + 3] = 255 & e,
                    t + 4
                }
                ,
                u.prototype.writeFloatLE = function(e, t, r) {
                    return w(this, e, t, !0, r)
                }
                ,
                u.prototype.writeFloatBE = function(e, t, r) {
                    return w(this, e, t, !1, r)
                }
                ,
                u.prototype.writeDoubleLE = function(e, t, r) {
                    return T(this, e, t, !0, r)
                }
                ,
                u.prototype.writeDoubleBE = function(e, t, r) {
                    return T(this, e, t, !1, r)
                }
                ,
                u.prototype.copy = function(e, t, r, n) {
                    if (!u.isBuffer(e))
                        throw new TypeError("argument should be a Buffer");
                    if (r = r || 0,
                    n || 0 === n || (n = this.length),
                    t >= e.length && (t = e.length),
                    (n = 0 < n && n < r ? r : n) === r)
                        return 0;
                    if (0 === e.length || 0 === this.length)
                        return 0;
                    if ((t = t || 0) < 0)
                        throw new RangeError("targetStart out of bounds");
                    if (r < 0 || r >= this.length)
                        throw new RangeError("Index out of range");
                    if (n < 0)
                        throw new RangeError("sourceEnd out of bounds");
                    n > this.length && (n = this.length);
                    var i = (n = e.length - t < n - r ? e.length - t + r : n) - r;
                    if (this === e && "function" == typeof Uint8Array.prototype.copyWithin)
                        this.copyWithin(t, r, n);
                    else if (this === e && r < t && t < n)
                        for (var o = i - 1; 0 <= o; --o)
                            e[o + t] = this[o + r];
                    else
                        Uint8Array.prototype.set.call(e, this.subarray(r, n), t);
                    return i
                }
                ,
                u.prototype.fill = function(e, t, r, n) {
                    if ("string" == typeof e) {
                        if ("string" == typeof t ? (n = t,
                        t = 0,
                        r = this.length) : "string" == typeof r && (n = r,
                        r = this.length),
                        void 0 !== n && "string" != typeof n)
                            throw new TypeError("encoding must be a string");
                        if ("string" == typeof n && !u.isEncoding(n))
                            throw new TypeError("Unknown encoding: " + n);
                        var i;
                        1 === e.length && (i = e.charCodeAt(0),
                        ("utf8" === n && i < 128 || "latin1" === n) && (e = i))
                    } else
                        "number" == typeof e && (e &= 255);
                    if (t < 0 || this.length < t || this.length < r)
                        throw new RangeError("Out of range index");
                    if (r <= t)
                        return this;
                    var o;
                    if (t >>>= 0,
                    r = void 0 === r ? this.length : r >>> 0,
                    "number" == typeof (e = e || 0))
                        for (o = t; o < r; ++o)
                            this[o] = e;
                    else {
                        var a = u.isBuffer(e) ? e : u.from(e, n)
                          , s = a.length;
                        if (0 === s)
                            throw new TypeError('The value "' + e + '" is invalid for argument "value"');
                        for (o = 0; o < r - t; ++o)
                            this[o + t] = a[o % s]
                    }
                    return this
                }
                ;
                var A = /[^+/0-9A-Za-z-_]/g;
                function R(e, t) {
                    var r;
                    t = t || 1 / 0;
                    for (var n = e.length, i = null, o = [], a = 0; a < n; ++a) {
                        if (55295 < (r = e.charCodeAt(a)) && r < 57344) {
                            if (!i) {
                                if (56319 < r) {
                                    -1 < (t -= 3) && o.push(239, 191, 189);
                                    continue
                                }
                                if (a + 1 === n) {
                                    -1 < (t -= 3) && o.push(239, 191, 189);
                                    continue
                                }
                                i = r;
                                continue
                            }
                            if (r < 56320) {
                                -1 < (t -= 3) && o.push(239, 191, 189),
                                i = r;
                                continue
                            }
                            r = 65536 + (i - 55296 << 10 | r - 56320)
                        } else
                            i && -1 < (t -= 3) && o.push(239, 191, 189);
                        if (i = null,
                        r < 128) {
                            if (--t < 0)
                                break;
                            o.push(r)
                        } else if (r < 2048) {
                            if ((t -= 2) < 0)
                                break;
                            o.push(r >> 6 | 192, 63 & r | 128)
                        } else if (r < 65536) {
                            if ((t -= 3) < 0)
                                break;
                            o.push(r >> 12 | 224, r >> 6 & 63 | 128, 63 & r | 128)
                        } else {
                            if (!(r < 1114112))
                                throw new Error("Invalid code point");
                            if ((t -= 4) < 0)
                                break;
                            o.push(r >> 18 | 240, r >> 12 & 63 | 128, r >> 6 & 63 | 128, 63 & r | 128)
                        }
                    }
                    return o
                }
                function I(e) {
                    return s.toByteArray(function(e) {
                        if ((e = (e = e.split("=")[0]).trim().replace(A, "")).length < 2)
                            return "";
                        for (; e.length % 4 != 0; )
                            e += "=";
                        return e
                    }(e))
                }
                function U(e, t, r, n) {
                    for (var i = 0; i < n && !(i + r >= t.length || i >= e.length); ++i)
                        t[i + r] = e[i];
                    return i
                }
                function P(e, t) {
                    return e instanceof t || null != e && null != e.constructor && null != e.constructor.name && e.constructor.name === t.name
                }
                function S(e) {
                    return e != e
                }
            }
            ).call(this)
        }
        ).call(this, N("buffer").Buffer)
    }
    , {
        "base64-js": 12,
        buffer: 14,
        ieee754: 52
    }],
    15: [function(e, t, r) {
        var s = e("element-size");
        t.exports = function(i, e, t) {
            var o = "SVG" === i.nodeName.toUpperCase();
            return i.style.position = i.style.position || "absolute",
            i.style.top = 0,
            i.style.left = 0,
            a.scale = parseFloat(t || 1),
            a.parent = e,
            a();
            function a() {
                var e, t, r, n = a.parent || i.parentNode;
                return r = "function" == typeof n ? (t = (e = n(c) || c)[0],
                e[1]) : n && n !== document.body ? (t = 0 | (r = s(n))[0],
                0 | r[1]) : (t = window.innerWidth,
                window.innerHeight),
                o ? (i.setAttribute("width", t * a.scale + "px"),
                i.setAttribute("height", r * a.scale + "px")) : (i.width = t * a.scale,
                i.height = r * a.scale),
                i.style.width = t + "px",
                i.style.height = r + "px",
                a
            }
        }
        ;
        var c = new Float32Array(2)
    }
    , {
        "element-size": 21
    }],
    16: [function(e, t, r) {
        "use strict";
        var o = e("./lib/thunk.js");
        function a() {
            this.argTypes = [],
            this.shimArgs = [],
            this.arrayArgs = [],
            this.arrayBlockIndices = [],
            this.scalarArgs = [],
            this.offsetArgs = [],
            this.offsetArgIndex = [],
            this.indexArgs = [],
            this.shapeArgs = [],
            this.funcName = "",
            this.pre = null,
            this.body = null,
            this.post = null,
            this.debug = !1
        }
        t.exports = function(e) {
            var t = new a;
            t.pre = e.pre,
            t.body = e.body,
            t.post = e.post;
            var r = e.args.slice(0);
            t.argTypes = r;
            for (var n = 0; n < r.length; ++n) {
                var i = r[n];
                if ("array" === i || "object" == typeof i && i.blockIndices) {
                    if (t.argTypes[n] = "array",
                    t.arrayArgs.push(n),
                    t.arrayBlockIndices.push(i.blockIndices || 0),
                    t.shimArgs.push("array" + n),
                    n < t.pre.args.length && 0 < t.pre.args[n].count)
                        throw new Error("cwise: pre() block may not reference array args");
                    if (n < t.post.args.length && 0 < t.post.args[n].count)
                        throw new Error("cwise: post() block may not reference array args")
                } else if ("scalar" === i)
                    t.scalarArgs.push(n),
                    t.shimArgs.push("scalar" + n);
                else if ("index" === i) {
                    if (t.indexArgs.push(n),
                    n < t.pre.args.length && 0 < t.pre.args[n].count)
                        throw new Error("cwise: pre() block may not reference array index");
                    if (n < t.body.args.length && t.body.args[n].lvalue)
                        throw new Error("cwise: body() block may not write to array index");
                    if (n < t.post.args.length && 0 < t.post.args[n].count)
                        throw new Error("cwise: post() block may not reference array index")
                } else if ("shape" === i) {
                    if (t.shapeArgs.push(n),
                    n < t.pre.args.length && t.pre.args[n].lvalue)
                        throw new Error("cwise: pre() block may not write to array shape");
                    if (n < t.body.args.length && t.body.args[n].lvalue)
                        throw new Error("cwise: body() block may not write to array shape");
                    if (n < t.post.args.length && t.post.args[n].lvalue)
                        throw new Error("cwise: post() block may not write to array shape")
                } else {
                    if ("object" != typeof i || !i.offset)
                        throw new Error("cwise: Unknown argument type " + r[n]);
                    t.argTypes[n] = "offset",
                    t.offsetArgs.push({
                        array: i.array,
                        offset: i.offset
                    }),
                    t.offsetArgIndex.push(n)
                }
            }
            if (t.arrayArgs.length <= 0)
                throw new Error("cwise: No array arguments specified");
            if (t.pre.args.length > r.length)
                throw new Error("cwise: Too many arguments in pre() block");
            if (t.body.args.length > r.length)
                throw new Error("cwise: Too many arguments in body() block");
            if (t.post.args.length > r.length)
                throw new Error("cwise: Too many arguments in post() block");
            return t.debug = !!e.printCode || !!e.debug,
            t.funcName = e.funcName || "cwise",
            t.blockSize = e.blockSize || 64,
            o(t)
        }
    }
    , {
        "./lib/thunk.js": 18
    }],
    17: [function(e, t, r) {
        "use strict";
        var b = e("uniq");
        function E(e, t, r) {
            for (var n, i = e.length, o = t.arrayArgs.length, a = 0 < t.indexArgs.length, s = [], c = [], f = 0, l = 0, u = 0; u < i; ++u)
                c.push(["i", u, "=0"].join(""));
            for (n = 0; n < o; ++n)
                for (u = 0; u < i; ++u)
                    l = f,
                    f = e[u],
                    0 === u ? c.push(["d", n, "s", u, "=t", n, "p", f].join("")) : c.push(["d", n, "s", u, "=(t", n, "p", f, "-s", l, "*t", n, "p", l, ")"].join(""));
            for (0 < c.length && s.push("var " + c.join(",")),
            u = i - 1; 0 <= u; --u)
                f = e[u],
                s.push(["for(i", u, "=0;i", u, "<s", f, ";++i", u, "){"].join(""));
            for (s.push(r),
            u = 0; u < i; ++u) {
                for (l = f,
                f = e[u],
                n = 0; n < o; ++n)
                    s.push(["p", n, "+=d", n, "s", u].join(""));
                a && (0 < u && s.push(["index[", l, "]-=s", l].join("")),
                s.push(["++index[", f, "]"].join(""))),
                s.push("}")
            }
            return s.join("\n")
        }
        function w(e, t, r) {
            for (var n = e.body, i = [], o = [], a = 0; a < e.args.length; ++a) {
                var s = e.args[a];
                if (!(s.count <= 0)) {
                    var c = new RegExp(s.name,"g")
                      , f = ""
                      , l = t.arrayArgs.indexOf(a);
                    switch (t.argTypes[a]) {
                    case "offset":
                        var u = t.offsetArgIndex.indexOf(a)
                          , l = t.offsetArgs[u].array
                          , f = "+q" + u;
                    case "array":
                        f = "p" + l + f;
                        var h = "l" + a
                          , u = "a" + l;
                        if (0 === t.arrayBlockIndices[l])
                            1 === s.count ? "generic" === r[l] ? s.lvalue ? (i.push(["var ", h, "=", u, ".get(", f, ")"].join("")),
                            n = n.replace(c, h),
                            o.push([u, ".set(", f, ",", h, ")"].join(""))) : n = n.replace(c, [u, ".get(", f, ")"].join("")) : n = n.replace(c, [u, "[", f, "]"].join("")) : "generic" === r[l] ? (i.push(["var ", h, "=", u, ".get(", f, ")"].join("")),
                            n = n.replace(c, h),
                            s.lvalue && o.push([u, ".set(", f, ",", h, ")"].join(""))) : (i.push(["var ", h, "=", u, "[", f, "]"].join("")),
                            n = n.replace(c, h),
                            s.lvalue && o.push([u, "[", f, "]=", h].join("")));
                        else {
                            for (var d = [s.name], p = [f], v = 0; v < Math.abs(t.arrayBlockIndices[l]); v++)
                                d.push("\\s*\\[([^\\]]+)\\]"),
                                p.push("$" + (v + 1) + "*t" + l + "b" + v);
                            if (c = new RegExp(d.join(""),"g"),
                            f = p.join("+"),
                            "generic" === r[l])
                                throw new Error("cwise: Generic arrays not supported in combination with blocks!");
                            n = n.replace(c, [u, "[", f, "]"].join(""))
                        }
                        break;
                    case "scalar":
                        n = n.replace(c, "Y" + t.scalarArgs.indexOf(a));
                        break;
                    case "index":
                        n = n.replace(c, "index");
                        break;
                    case "shape":
                        n = n.replace(c, "shape")
                    }
                }
            }
            return [i.join("\n"), n, o.join("\n")].join("\n").trim()
        }
        t.exports = function(e, t) {
            for (var r = t[1].length - Math.abs(e.arrayBlockIndices[0]) | 0, n = new Array(e.arrayArgs.length), i = new Array(e.arrayArgs.length), o = 0; o < e.arrayArgs.length; ++o)
                i[o] = t[2 * o],
                n[o] = t[2 * o + 1];
            for (var a = [], s = [], c = [], f = [], l = [], o = 0; o < e.arrayArgs.length; ++o) {
                e.arrayBlockIndices[o] < 0 ? (c.push(0),
                f.push(r),
                a.push(r),
                s.push(r + e.arrayBlockIndices[o])) : (c.push(e.arrayBlockIndices[o]),
                f.push(e.arrayBlockIndices[o] + r),
                a.push(0),
                s.push(e.arrayBlockIndices[o]));
                for (var u = [], h = 0; h < n[o].length; h++)
                    c[o] <= n[o][h] && n[o][h] < f[o] && u.push(n[o][h] - c[o]);
                l.push(u)
            }
            for (var d = ["SS"], p = ["'use strict'"], v = [], h = 0; h < r; ++h)
                v.push(["s", h, "=SS[", h, "]"].join(""));
            for (o = 0; o < e.arrayArgs.length; ++o) {
                d.push("a" + o),
                d.push("t" + o),
                d.push("p" + o);
                for (h = 0; h < r; ++h)
                    v.push(["t", o, "p", h, "=t", o, "[", c[o] + h, "]"].join(""));
                for (h = 0; h < Math.abs(e.arrayBlockIndices[o]); ++h)
                    v.push(["t", o, "b", h, "=t", o, "[", a[o] + h, "]"].join(""))
            }
            for (o = 0; o < e.scalarArgs.length; ++o)
                d.push("Y" + o);
            if (0 < e.shapeArgs.length && v.push("shape=SS.slice(0)"),
            0 < e.indexArgs.length) {
                for (var g = new Array(r), o = 0; o < r; ++o)
                    g[o] = "0";
                v.push(["index=[", g.join(","), "]"].join(""))
            }
            for (o = 0; o < e.offsetArgs.length; ++o) {
                for (var y = e.offsetArgs[o], m = [], h = 0; h < y.offset.length; ++h)
                    0 !== y.offset[h] && (1 === y.offset[h] ? m.push(["t", y.array, "p", h].join("")) : m.push([y.offset[h], "*t", y.array, "p", h].join("")));
                0 === m.length ? v.push("q" + o + "=0") : v.push(["q", o, "=", m.join("+")].join(""))
            }
            var _ = b([].concat(e.pre.thisVars).concat(e.body.thisVars).concat(e.post.thisVars));
            for (0 < (v = v.concat(_)).length && p.push("var " + v.join(",")),
            o = 0; o < e.arrayArgs.length; ++o)
                p.push("p" + o + "|=0");
            3 < e.pre.body.length && p.push(w(e.pre, e, i));
            var x = w(e.body, e, i);
            return (_ = function(e) {
                for (var t = 0, r = e[0].length; t < r; ) {
                    for (var n = 1; n < e.length; ++n)
                        if (e[n][t] !== e[0][t])
                            return t;
                    ++t
                }
                return t
            }(l)) < r ? p.push(function(e, t, r, n) {
                for (var i = t.length, o = r.arrayArgs.length, a = r.blockSize, s = 0 < r.indexArgs.length, c = [], f = 0; f < o; ++f)
                    c.push(["var offset", f, "=p", f].join(""));
                for (f = e; f < i; ++f)
                    c.push(["for(var j" + f + "=SS[", t[f], "]|0;j", f, ">0;){"].join("")),
                    c.push(["if(j", f, "<", a, "){"].join("")),
                    c.push(["s", t[f], "=j", f].join("")),
                    c.push(["j", f, "=0"].join("")),
                    c.push(["}else{s", t[f], "=", a].join("")),
                    c.push(["j", f, "-=", a, "}"].join("")),
                    s && c.push(["index[", t[f], "]=j", f].join(""));
                for (f = 0; f < o; ++f) {
                    for (var l = ["offset" + f], u = e; u < i; ++u)
                        l.push(["j", u, "*t", f, "p", t[u]].join(""));
                    c.push(["p", f, "=(", l.join("+"), ")"].join(""))
                }
                for (c.push(E(t, r, n)),
                f = e; f < i; ++f)
                    c.push("}");
                return c.join("\n")
            }(_, l[0], e, x)) : p.push(E(l[0], e, x)),
            3 < e.post.body.length && p.push(w(e.post, e, i)),
            e.debug && console.log("-----Generated cwise routine for ", t, ":\n" + p.join("\n") + "\n----------"),
            _ = [e.funcName || "unnamed", "_cwise_loop_", n[0].join("s"), "m", _, function(e) {
                for (var t = new Array(e.length), r = !0, n = 0; n < e.length; ++n) {
                    var i = e[n]
                      , o = (o = i.match(/\d+/)) ? o[0] : "";
                    0 === i.charAt(0) ? t[n] = "u" + i.charAt(1) + o : t[n] = i.charAt(0) + o,
                    0 < n && (r = r && t[n] === t[n - 1])
                }
                return r ? t[0] : t.join("")
            }(i)].join(""),
            new Function(["function ", _, "(", d.join(","), "){", p.join("\n"), "} return ", _].join(""))()
        }
    }
    , {
        uniq: 69
    }],
    18: [function(e, t, r) {
        "use strict";
        var u = e("./compile.js");
        t.exports = function(e) {
            var t = ["'use strict'", "var CACHED={}"]
              , r = []
              , n = e.funcName + "_cwise_thunk";
            t.push(["return function ", n, "(", e.shimArgs.join(","), "){"].join(""));
            for (var i = [], o = [], a = [["array", e.arrayArgs[0], ".shape.slice(", Math.max(0, e.arrayBlockIndices[0]), e.arrayBlockIndices[0] < 0 ? "," + e.arrayBlockIndices[0] + ")" : ")"].join("")], s = [], c = [], f = 0; f < e.arrayArgs.length; ++f) {
                var l = e.arrayArgs[f];
                r.push(["t", l, "=array", l, ".dtype,", "r", l, "=array", l, ".order"].join("")),
                i.push("t" + l),
                i.push("r" + l),
                o.push("t" + l),
                o.push("r" + l + ".join()"),
                a.push("array" + l + ".data"),
                a.push("array" + l + ".stride"),
                a.push("array" + l + ".offset|0"),
                0 < f && (s.push("array" + e.arrayArgs[0] + ".shape.length===array" + l + ".shape.length+" + (Math.abs(e.arrayBlockIndices[0]) - Math.abs(e.arrayBlockIndices[f]))),
                c.push("array" + e.arrayArgs[0] + ".shape[shapeIndex+" + Math.max(0, e.arrayBlockIndices[0]) + "]===array" + l + ".shape[shapeIndex+" + Math.max(0, e.arrayBlockIndices[f]) + "]"))
            }
            for (1 < e.arrayArgs.length && (t.push("if (!(" + s.join(" && ") + ")) throw new Error('cwise: Arrays do not all have the same dimensionality!')"),
            t.push("for(var shapeIndex=array" + e.arrayArgs[0] + ".shape.length-" + Math.abs(e.arrayBlockIndices[0]) + "; shapeIndex--\x3e0;) {"),
            t.push("if (!(" + c.join(" && ") + ")) throw new Error('cwise: Arrays do not all have the same shape!')"),
            t.push("}")),
            f = 0; f < e.scalarArgs.length; ++f)
                a.push("scalar" + e.scalarArgs[f]);
            return r.push(["type=[", o.join(","), "].join()"].join("")),
            r.push("proc=CACHED[type]"),
            t.push("var " + r.join(",")),
            t.push(["if(!proc){", "CACHED[type]=proc=compile([", i.join(","), "])}", "return proc(", a.join(","), ")}"].join("")),
            e.debug && console.log("-----Generated thunk:\n" + t.join("\n") + "\n----------"),
            new Function("compile",t.join("\n"))(u.bind(void 0, e))
        }
    }
    , {
        "./compile.js": 17
    }],
    19: [function(e, t, r) {
        t.exports = e("cwise-compiler")
    }
    , {
        "cwise-compiler": 16
    }],
    20: [function(e, t, r) {
        "use strict";
        t.exports = function(e, t) {
            switch (void 0 === t && (t = 0),
            typeof e) {
            case "number":
                if (0 < e)
                    return function(e, t) {
                        for (var r = new Array(e), n = 0; n < e; ++n)
                            r[n] = t;
                        return r
                    }(0 | e, t);
                break;
            case "object":
                if ("number" == typeof e.length)
                    return function e(t, r, n) {
                        var i = 0 | t[n];
                        if (i <= 0)
                            return [];
                        var o, a = new Array(i);
                        if (n === t.length - 1)
                            for (o = 0; o < i; ++o)
                                a[o] = r;
                        else
                            for (o = 0; o < i; ++o)
                                a[o] = e(t, r, n + 1);
                        return a
                    }(e, t, 0)
            }
            return []
        }
    }
    , {}],
    21: [function(e, t, r) {
        function o(e) {
            return parseFloat(e) || 0
        }
        t.exports = function(e) {
            if (e === window || e === document.body)
                return [window.innerWidth, window.innerHeight];
            {
                var t;
                e.parentNode || (t = !0,
                document.body.appendChild(e))
            }
            var r = e.getBoundingClientRect()
              , n = getComputedStyle(e)
              , i = (0 | r.height) + o(n.getPropertyValue("margin-top")) + o(n.getPropertyValue("margin-bottom"))
              , n = (0 | r.width) + o(n.getPropertyValue("margin-left")) + o(n.getPropertyValue("margin-right"));
            t && document.body.removeChild(e);
            return [n, i]
        }
    }
    , {}],
    22: [function(e, t, r) {
        "use strict";
        var n = "object" == typeof Reflect ? Reflect : null
          , c = n && "function" == typeof n.apply ? n.apply : function(e, t, r) {
            return Function.prototype.apply.call(e, t, r)
        }
        ;
        var i = n && "function" == typeof n.ownKeys ? n.ownKeys : Object.getOwnPropertySymbols ? function(e) {
            return Object.getOwnPropertyNames(e).concat(Object.getOwnPropertySymbols(e))
        }
        : function(e) {
            return Object.getOwnPropertyNames(e)
        }
          , o = Number.isNaN || function(e) {
            return e != e
        }
        ;
        function a() {
            a.init.call(this)
        }
        t.exports = a,
        t.exports.once = function(s, c) {
            return new Promise(function(e, t) {
                function r(e) {
                    s.removeListener(c, n),
                    t(e)
                }
                function n() {
                    "function" == typeof s.removeListener && s.removeListener("error", r),
                    e([].slice.call(arguments))
                }
                var i, o, a;
                g(s, c, n, {
                    once: !0
                }),
                "error" !== c && (o = r,
                a = {
                    once: !0
                },
                "function" == typeof (i = s).on && g(i, "error", o, a))
            }
            )
        }
        ,
        (a.EventEmitter = a).prototype._events = void 0,
        a.prototype._eventsCount = 0,
        a.prototype._maxListeners = void 0;
        var s = 10;
        function f(e) {
            if ("function" != typeof e)
                throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof e)
        }
        function l(e) {
            return void 0 === e._maxListeners ? a.defaultMaxListeners : e._maxListeners
        }
        function u(e, t, r, n) {
            var i, o;
            return f(r),
            void 0 === (o = e._events) ? (o = e._events = Object.create(null),
            e._eventsCount = 0) : (void 0 !== o.newListener && (e.emit("newListener", t, r.listener || r),
            o = e._events),
            i = o[t]),
            void 0 === i ? (i = o[t] = r,
            ++e._eventsCount) : ("function" == typeof i ? i = o[t] = n ? [r, i] : [i, r] : n ? i.unshift(r) : i.push(r),
            0 < (o = l(e)) && i.length > o && !i.warned && (i.warned = !0,
            (o = new Error("Possible EventEmitter memory leak detected. " + i.length + " " + String(t) + " listeners added. Use emitter.setMaxListeners() to increase limit")).name = "MaxListenersExceededWarning",
            o.emitter = e,
            o.type = t,
            o.count = i.length,
            t = o,
            console && console.warn && console.warn(t))),
            e
        }
        function h(e, t, r) {
            var n = {
                fired: !1,
                wrapFn: void 0,
                target: e,
                type: t,
                listener: r
            }
              , i = (function() {
                if (!this.fired)
                    return this.target.removeListener(this.type, this.wrapFn),
                    this.fired = !0,
                    0 === arguments.length ? this.listener.call(this.target) : this.listener.apply(this.target, arguments)
            }
            ).bind(n);
            return i.listener = r,
            n.wrapFn = i
        }
        function d(e, t, r) {
            var n = e._events;
            if (void 0 === n)
                return [];
            n = n[t];
            return void 0 === n ? [] : "function" == typeof n ? r ? [n.listener || n] : [n] : r ? function(e) {
                for (var t = new Array(e.length), r = 0; r < t.length; ++r)
                    t[r] = e[r].listener || e[r];
                return t
            }(n) : v(n, n.length)
        }
        function p(e) {
            var t = this._events;
            if (void 0 !== t) {
                t = t[e];
                if ("function" == typeof t)
                    return 1;
                if (void 0 !== t)
                    return t.length
            }
            return 0
        }
        function v(e, t) {
            for (var r = new Array(t), n = 0; n < t; ++n)
                r[n] = e[n];
            return r
        }
        function g(r, n, i, o) {
            if ("function" == typeof r.on)
                o.once ? r.once(n, i) : r.on(n, i);
            else {
                if ("function" != typeof r.addEventListener)
                    throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof r);
                r.addEventListener(n, function e(t) {
                    o.once && r.removeEventListener(n, e),
                    i(t)
                })
            }
        }
        Object.defineProperty(a, "defaultMaxListeners", {
            enumerable: !0,
            get: function() {
                return s
            },
            set: function(e) {
                if ("number" != typeof e || e < 0 || o(e))
                    throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + e + ".");
                s = e
            }
        }),
        a.init = function() {
            void 0 !== this._events && this._events !== Object.getPrototypeOf(this)._events || (this._events = Object.create(null),
            this._eventsCount = 0),
            this._maxListeners = this._maxListeners || void 0
        }
        ,
        a.prototype.setMaxListeners = function(e) {
            if ("number" != typeof e || e < 0 || o(e))
                throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + e + ".");
            return this._maxListeners = e,
            this
        }
        ,
        a.prototype.getMaxListeners = function() {
            return l(this)
        }
        ,
        a.prototype.emit = function(e) {
            for (var t = [], r = 1; r < arguments.length; r++)
                t.push(arguments[r]);
            var n, i = "error" === e, o = this._events;
            if (void 0 !== o)
                i = i && void 0 === o.error;
            else if (!i)
                return !1;
            if (i) {
                if ((n = 0 < t.length ? t[0] : n)instanceof Error)
                    throw n;
                i = new Error("Unhandled error." + (n ? " (" + n.message + ")" : ""));
                throw i.context = n,
                i
            }
            o = o[e];
            if (void 0 === o)
                return !1;
            if ("function" == typeof o)
                c(o, this, t);
            else
                for (var a = o.length, s = v(o, a), r = 0; r < a; ++r)
                    c(s[r], this, t);
            return !0
        }
        ,
        a.prototype.on = a.prototype.addListener = function(e, t) {
            return u(this, e, t, !1)
        }
        ,
        a.prototype.prependListener = function(e, t) {
            return u(this, e, t, !0)
        }
        ,
        a.prototype.once = function(e, t) {
            return f(t),
            this.on(e, h(this, e, t)),
            this
        }
        ,
        a.prototype.prependOnceListener = function(e, t) {
            return f(t),
            this.prependListener(e, h(this, e, t)),
            this
        }
        ,
        a.prototype.removeListener = function(e, t) {
            var r, n, i, o, a;
            if (f(t),
            void 0 === (n = this._events))
                return this;
            if (void 0 === (r = n[e]))
                return this;
            if (r === t || r.listener === t)
                0 == --this._eventsCount ? this._events = Object.create(null) : (delete n[e],
                n.removeListener && this.emit("removeListener", e, r.listener || t));
            else if ("function" != typeof r) {
                for (i = -1,
                o = r.length - 1; 0 <= o; o--)
                    if (r[o] === t || r[o].listener === t) {
                        a = r[o].listener,
                        i = o;
                        break
                    }
                if (i < 0)
                    return this;
                0 === i ? r.shift() : function(e, t) {
                    for (; t + 1 < e.length; t++)
                        e[t] = e[t + 1];
                    e.pop()
                }(r, i),
                1 === r.length && (n[e] = r[0]),
                void 0 !== n.removeListener && this.emit("removeListener", e, a || t)
            }
            return this
        }
        ,
        a.prototype.off = a.prototype.removeListener,
        a.prototype.removeAllListeners = function(e) {
            var t, r = this._events;
            if (void 0 === r)
                return this;
            if (void 0 === r.removeListener)
                return 0 === arguments.length ? (this._events = Object.create(null),
                this._eventsCount = 0) : void 0 !== r[e] && (0 == --this._eventsCount ? this._events = Object.create(null) : delete r[e]),
                this;
            if (0 === arguments.length) {
                for (var n, i = Object.keys(r), o = 0; o < i.length; ++o)
                    "removeListener" !== (n = i[o]) && this.removeAllListeners(n);
                return this.removeAllListeners("removeListener"),
                this._events = Object.create(null),
                this._eventsCount = 0,
                this
            }
            if ("function" == typeof (t = r[e]))
                this.removeListener(e, t);
            else if (void 0 !== t)
                for (o = t.length - 1; 0 <= o; o--)
                    this.removeListener(e, t[o]);
            return this
        }
        ,
        a.prototype.listeners = function(e) {
            return d(this, e, !0)
        }
        ,
        a.prototype.rawListeners = function(e) {
            return d(this, e, !1)
        }
        ,
        a.listenerCount = function(e, t) {
            return "function" == typeof e.listenerCount ? e.listenerCount(t) : p.call(e, t)
        }
        ,
        a.prototype.listenerCount = p,
        a.prototype.eventNames = function() {
            return 0 < this._eventsCount ? i(this._events) : []
        }
    }
    , {}],
    23: [function(e, t, r) {
        t.exports = function(e, t) {
            if ("string" != typeof e)
                throw new TypeError("must specify type string");
            if (t = t || {},
            "undefined" == typeof document && !t.canvas)
                return null;
            var r = t.canvas || document.createElement("canvas");
            "number" == typeof t.width && (r.width = t.width);
            "number" == typeof t.height && (r.height = t.height);
            var n, i = t;
            try {
                var o = [e];
                0 === e.indexOf("webgl") && o.push("experimental-" + e);
                for (var a = 0; a < o.length; a++)
                    if (n = r.getContext(o[a], i))
                        return n
            } catch (e) {
                n = null
            }
            return n || null
        }
    }
    , {}],
    24: [function(e, t, r) {
        "use strict";
        var o = e("typedarray-pool")
          , i = e("ndarray-ops")
          , a = e("ndarray")
          , s = ["uint8", "uint8_clamped", "uint16", "uint32", "int8", "int16", "int32", "float32"];
        function c(e, t, r, n, i) {
            this.gl = e,
            this.type = t,
            this.handle = r,
            this.length = n,
            this.usage = i
        }
        var n = c.prototype;
        function f(e, t, r, n, i, o) {
            var a = i.length * i.BYTES_PER_ELEMENT;
            if (o < 0)
                return e.bufferData(t, i, n),
                a;
            if (r < a + o)
                throw new Error("gl-buffer: If resizing buffer, must not specify offset");
            return e.bufferSubData(t, o, i),
            r
        }
        function l(e, t) {
            for (var r = o.malloc(e.length, t), n = e.length, i = 0; i < n; ++i)
                r[i] = e[i];
            return r
        }
        n.bind = function() {
            this.gl.bindBuffer(this.type, this.handle)
        }
        ,
        n.unbind = function() {
            this.gl.bindBuffer(this.type, null)
        }
        ,
        n.dispose = function() {
            this.gl.deleteBuffer(this.handle)
        }
        ,
        n.update = function(e, t) {
            if ("number" != typeof t && (t = -1),
            this.bind(),
            "object" == typeof e && void 0 !== e.shape) {
                var r = e.dtype;
                s.indexOf(r) < 0 && (r = "float32"),
                (r = this.type === this.gl.ELEMENT_ARRAY_BUFFER ? gl.getExtension("OES_element_index_uint") && "uint16" !== r ? "uint32" : "uint16" : r) === e.dtype && function(e, t) {
                    for (var r = 1, n = t.length - 1; 0 <= n; --n) {
                        if (t[n] !== r)
                            return;
                        r *= e[n]
                    }
                    return 1
                }(e.shape, e.stride) ? 0 === e.offset && e.data.length === e.shape[0] ? this.length = f(this.gl, this.type, this.length, this.usage, e.data, t) : this.length = f(this.gl, this.type, this.length, this.usage, e.data.subarray(e.offset, e.shape[0]), t) : (n = o.malloc(e.size, r),
                r = a(n, e.shape),
                i.assign(r, e),
                this.length = f(this.gl, this.type, this.length, this.usage, t < 0 ? n : n.subarray(0, e.size), t),
                o.free(n))
            } else if (Array.isArray(e)) {
                var n = this.type === this.gl.ELEMENT_ARRAY_BUFFER ? l(e, "uint16") : l(e, "float32");
                this.length = f(this.gl, this.type, this.length, this.usage, t < 0 ? n : n.subarray(0, e.length), t),
                o.free(n)
            } else if ("object" == typeof e && "number" == typeof e.length)
                this.length = f(this.gl, this.type, this.length, this.usage, e, t);
            else {
                if ("number" != typeof e && void 0 !== e)
                    throw new Error("gl-buffer: Invalid data type");
                if (0 <= t)
                    throw new Error("gl-buffer: Cannot specify offset when resizing buffer");
                this.gl.bufferData(this.type, 0 | (e = (e |= 0) <= 0 ? 1 : e), this.usage),
                this.length = e
            }
        }
        ,
        t.exports = function(e, t, r, n) {
            if (r = r || e.ARRAY_BUFFER,
            n = n || e.DYNAMIC_DRAW,
            r !== e.ARRAY_BUFFER && r !== e.ELEMENT_ARRAY_BUFFER)
                throw new Error("gl-buffer: Invalid type for webgl buffer, must be either gl.ARRAY_BUFFER or gl.ELEMENT_ARRAY_BUFFER");
            if (n !== e.DYNAMIC_DRAW && n !== e.STATIC_DRAW && n !== e.STREAM_DRAW)
                throw new Error("gl-buffer: Invalid usage for buffer, must be either gl.DYNAMIC_DRAW, gl.STATIC_DRAW or gl.STREAM_DRAW");
            var i = e.createBuffer();
            return (i = new c(e,r,i,0,n)).update(t),
            i
        }
    }
    , {
        ndarray: 58,
        "ndarray-ops": 57,
        "typedarray-pool": 68
    }],
    25: [function(e, t, r) {
        t.exports = {
            0: "NONE",
            1: "ONE",
            2: "LINE_LOOP",
            3: "LINE_STRIP",
            4: "TRIANGLES",
            5: "TRIANGLE_STRIP",
            6: "TRIANGLE_FAN",
            256: "DEPTH_BUFFER_BIT",
            512: "NEVER",
            513: "LESS",
            514: "EQUAL",
            515: "LEQUAL",
            516: "GREATER",
            517: "NOTEQUAL",
            518: "GEQUAL",
            519: "ALWAYS",
            768: "SRC_COLOR",
            769: "ONE_MINUS_SRC_COLOR",
            770: "SRC_ALPHA",
            771: "ONE_MINUS_SRC_ALPHA",
            772: "DST_ALPHA",
            773: "ONE_MINUS_DST_ALPHA",
            774: "DST_COLOR",
            775: "ONE_MINUS_DST_COLOR",
            776: "SRC_ALPHA_SATURATE",
            1024: "STENCIL_BUFFER_BIT",
            1028: "FRONT",
            1029: "BACK",
            1032: "FRONT_AND_BACK",
            1280: "INVALID_ENUM",
            1281: "INVALID_VALUE",
            1282: "INVALID_OPERATION",
            1285: "OUT_OF_MEMORY",
            1286: "INVALID_FRAMEBUFFER_OPERATION",
            2304: "CW",
            2305: "CCW",
            2849: "LINE_WIDTH",
            2884: "CULL_FACE",
            2885: "CULL_FACE_MODE",
            2886: "FRONT_FACE",
            2928: "DEPTH_RANGE",
            2929: "DEPTH_TEST",
            2930: "DEPTH_WRITEMASK",
            2931: "DEPTH_CLEAR_VALUE",
            2932: "DEPTH_FUNC",
            2960: "STENCIL_TEST",
            2961: "STENCIL_CLEAR_VALUE",
            2962: "STENCIL_FUNC",
            2963: "STENCIL_VALUE_MASK",
            2964: "STENCIL_FAIL",
            2965: "STENCIL_PASS_DEPTH_FAIL",
            2966: "STENCIL_PASS_DEPTH_PASS",
            2967: "STENCIL_REF",
            2968: "STENCIL_WRITEMASK",
            2978: "VIEWPORT",
            3024: "DITHER",
            3042: "BLEND",
            3088: "SCISSOR_BOX",
            3089: "SCISSOR_TEST",
            3106: "COLOR_CLEAR_VALUE",
            3107: "COLOR_WRITEMASK",
            3317: "UNPACK_ALIGNMENT",
            3333: "PACK_ALIGNMENT",
            3379: "MAX_TEXTURE_SIZE",
            3386: "MAX_VIEWPORT_DIMS",
            3408: "SUBPIXEL_BITS",
            3410: "RED_BITS",
            3411: "GREEN_BITS",
            3412: "BLUE_BITS",
            3413: "ALPHA_BITS",
            3414: "DEPTH_BITS",
            3415: "STENCIL_BITS",
            3553: "TEXTURE_2D",
            4352: "DONT_CARE",
            4353: "FASTEST",
            4354: "NICEST",
            5120: "BYTE",
            5121: "UNSIGNED_BYTE",
            5122: "SHORT",
            5123: "UNSIGNED_SHORT",
            5124: "INT",
            5125: "UNSIGNED_INT",
            5126: "FLOAT",
            5386: "INVERT",
            5890: "TEXTURE",
            6401: "STENCIL_INDEX",
            6402: "DEPTH_COMPONENT",
            6406: "ALPHA",
            6407: "RGB",
            6408: "RGBA",
            6409: "LUMINANCE",
            6410: "LUMINANCE_ALPHA",
            7680: "KEEP",
            7681: "REPLACE",
            7682: "INCR",
            7683: "DECR",
            7936: "VENDOR",
            7937: "RENDERER",
            7938: "VERSION",
            9728: "NEAREST",
            9729: "LINEAR",
            9984: "NEAREST_MIPMAP_NEAREST",
            9985: "LINEAR_MIPMAP_NEAREST",
            9986: "NEAREST_MIPMAP_LINEAR",
            9987: "LINEAR_MIPMAP_LINEAR",
            10240: "TEXTURE_MAG_FILTER",
            10241: "TEXTURE_MIN_FILTER",
            10242: "TEXTURE_WRAP_S",
            10243: "TEXTURE_WRAP_T",
            10497: "REPEAT",
            10752: "POLYGON_OFFSET_UNITS",
            16384: "COLOR_BUFFER_BIT",
            32769: "CONSTANT_COLOR",
            32770: "ONE_MINUS_CONSTANT_COLOR",
            32771: "CONSTANT_ALPHA",
            32772: "ONE_MINUS_CONSTANT_ALPHA",
            32773: "BLEND_COLOR",
            32774: "FUNC_ADD",
            32777: "BLEND_EQUATION_RGB",
            32778: "FUNC_SUBTRACT",
            32779: "FUNC_REVERSE_SUBTRACT",
            32819: "UNSIGNED_SHORT_4_4_4_4",
            32820: "UNSIGNED_SHORT_5_5_5_1",
            32823: "POLYGON_OFFSET_FILL",
            32824: "POLYGON_OFFSET_FACTOR",
            32854: "RGBA4",
            32855: "RGB5_A1",
            32873: "TEXTURE_BINDING_2D",
            32926: "SAMPLE_ALPHA_TO_COVERAGE",
            32928: "SAMPLE_COVERAGE",
            32936: "SAMPLE_BUFFERS",
            32937: "SAMPLES",
            32938: "SAMPLE_COVERAGE_VALUE",
            32939: "SAMPLE_COVERAGE_INVERT",
            32968: "BLEND_DST_RGB",
            32969: "BLEND_SRC_RGB",
            32970: "BLEND_DST_ALPHA",
            32971: "BLEND_SRC_ALPHA",
            33071: "CLAMP_TO_EDGE",
            33170: "GENERATE_MIPMAP_HINT",
            33189: "DEPTH_COMPONENT16",
            33306: "DEPTH_STENCIL_ATTACHMENT",
            33635: "UNSIGNED_SHORT_5_6_5",
            33648: "MIRRORED_REPEAT",
            33901: "ALIASED_POINT_SIZE_RANGE",
            33902: "ALIASED_LINE_WIDTH_RANGE",
            33984: "TEXTURE0",
            33985: "TEXTURE1",
            33986: "TEXTURE2",
            33987: "TEXTURE3",
            33988: "TEXTURE4",
            33989: "TEXTURE5",
            33990: "TEXTURE6",
            33991: "TEXTURE7",
            33992: "TEXTURE8",
            33993: "TEXTURE9",
            33994: "TEXTURE10",
            33995: "TEXTURE11",
            33996: "TEXTURE12",
            33997: "TEXTURE13",
            33998: "TEXTURE14",
            33999: "TEXTURE15",
            34e3: "TEXTURE16",
            34001: "TEXTURE17",
            34002: "TEXTURE18",
            34003: "TEXTURE19",
            34004: "TEXTURE20",
            34005: "TEXTURE21",
            34006: "TEXTURE22",
            34007: "TEXTURE23",
            34008: "TEXTURE24",
            34009: "TEXTURE25",
            34010: "TEXTURE26",
            34011: "TEXTURE27",
            34012: "TEXTURE28",
            34013: "TEXTURE29",
            34014: "TEXTURE30",
            34015: "TEXTURE31",
            34016: "ACTIVE_TEXTURE",
            34024: "MAX_RENDERBUFFER_SIZE",
            34041: "DEPTH_STENCIL",
            34055: "INCR_WRAP",
            34056: "DECR_WRAP",
            34067: "TEXTURE_CUBE_MAP",
            34068: "TEXTURE_BINDING_CUBE_MAP",
            34069: "TEXTURE_CUBE_MAP_POSITIVE_X",
            34070: "TEXTURE_CUBE_MAP_NEGATIVE_X",
            34071: "TEXTURE_CUBE_MAP_POSITIVE_Y",
            34072: "TEXTURE_CUBE_MAP_NEGATIVE_Y",
            34073: "TEXTURE_CUBE_MAP_POSITIVE_Z",
            34074: "TEXTURE_CUBE_MAP_NEGATIVE_Z",
            34076: "MAX_CUBE_MAP_TEXTURE_SIZE",
            34338: "VERTEX_ATTRIB_ARRAY_ENABLED",
            34339: "VERTEX_ATTRIB_ARRAY_SIZE",
            34340: "VERTEX_ATTRIB_ARRAY_STRIDE",
            34341: "VERTEX_ATTRIB_ARRAY_TYPE",
            34342: "CURRENT_VERTEX_ATTRIB",
            34373: "VERTEX_ATTRIB_ARRAY_POINTER",
            34466: "NUM_COMPRESSED_TEXTURE_FORMATS",
            34467: "COMPRESSED_TEXTURE_FORMATS",
            34660: "BUFFER_SIZE",
            34661: "BUFFER_USAGE",
            34816: "STENCIL_BACK_FUNC",
            34817: "STENCIL_BACK_FAIL",
            34818: "STENCIL_BACK_PASS_DEPTH_FAIL",
            34819: "STENCIL_BACK_PASS_DEPTH_PASS",
            34877: "BLEND_EQUATION_ALPHA",
            34921: "MAX_VERTEX_ATTRIBS",
            34922: "VERTEX_ATTRIB_ARRAY_NORMALIZED",
            34930: "MAX_TEXTURE_IMAGE_UNITS",
            34962: "ARRAY_BUFFER",
            34963: "ELEMENT_ARRAY_BUFFER",
            34964: "ARRAY_BUFFER_BINDING",
            34965: "ELEMENT_ARRAY_BUFFER_BINDING",
            34975: "VERTEX_ATTRIB_ARRAY_BUFFER_BINDING",
            35040: "STREAM_DRAW",
            35044: "STATIC_DRAW",
            35048: "DYNAMIC_DRAW",
            35632: "FRAGMENT_SHADER",
            35633: "VERTEX_SHADER",
            35660: "MAX_VERTEX_TEXTURE_IMAGE_UNITS",
            35661: "MAX_COMBINED_TEXTURE_IMAGE_UNITS",
            35663: "SHADER_TYPE",
            35664: "FLOAT_VEC2",
            35665: "FLOAT_VEC3",
            35666: "FLOAT_VEC4",
            35667: "INT_VEC2",
            35668: "INT_VEC3",
            35669: "INT_VEC4",
            35670: "BOOL",
            35671: "BOOL_VEC2",
            35672: "BOOL_VEC3",
            35673: "BOOL_VEC4",
            35674: "FLOAT_MAT2",
            35675: "FLOAT_MAT3",
            35676: "FLOAT_MAT4",
            35678: "SAMPLER_2D",
            35680: "SAMPLER_CUBE",
            35712: "DELETE_STATUS",
            35713: "COMPILE_STATUS",
            35714: "LINK_STATUS",
            35715: "VALIDATE_STATUS",
            35716: "INFO_LOG_LENGTH",
            35717: "ATTACHED_SHADERS",
            35718: "ACTIVE_UNIFORMS",
            35719: "ACTIVE_UNIFORM_MAX_LENGTH",
            35720: "SHADER_SOURCE_LENGTH",
            35721: "ACTIVE_ATTRIBUTES",
            35722: "ACTIVE_ATTRIBUTE_MAX_LENGTH",
            35724: "SHADING_LANGUAGE_VERSION",
            35725: "CURRENT_PROGRAM",
            36003: "STENCIL_BACK_REF",
            36004: "STENCIL_BACK_VALUE_MASK",
            36005: "STENCIL_BACK_WRITEMASK",
            36006: "FRAMEBUFFER_BINDING",
            36007: "RENDERBUFFER_BINDING",
            36048: "FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE",
            36049: "FRAMEBUFFER_ATTACHMENT_OBJECT_NAME",
            36050: "FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL",
            36051: "FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE",
            36053: "FRAMEBUFFER_COMPLETE",
            36054: "FRAMEBUFFER_INCOMPLETE_ATTACHMENT",
            36055: "FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT",
            36057: "FRAMEBUFFER_INCOMPLETE_DIMENSIONS",
            36061: "FRAMEBUFFER_UNSUPPORTED",
            36064: "COLOR_ATTACHMENT0",
            36096: "DEPTH_ATTACHMENT",
            36128: "STENCIL_ATTACHMENT",
            36160: "FRAMEBUFFER",
            36161: "RENDERBUFFER",
            36162: "RENDERBUFFER_WIDTH",
            36163: "RENDERBUFFER_HEIGHT",
            36164: "RENDERBUFFER_INTERNAL_FORMAT",
            36168: "STENCIL_INDEX8",
            36176: "RENDERBUFFER_RED_SIZE",
            36177: "RENDERBUFFER_GREEN_SIZE",
            36178: "RENDERBUFFER_BLUE_SIZE",
            36179: "RENDERBUFFER_ALPHA_SIZE",
            36180: "RENDERBUFFER_DEPTH_SIZE",
            36181: "RENDERBUFFER_STENCIL_SIZE",
            36194: "RGB565",
            36336: "LOW_FLOAT",
            36337: "MEDIUM_FLOAT",
            36338: "HIGH_FLOAT",
            36339: "LOW_INT",
            36340: "MEDIUM_INT",
            36341: "HIGH_INT",
            36346: "SHADER_COMPILER",
            36347: "MAX_VERTEX_UNIFORM_VECTORS",
            36348: "MAX_VARYING_VECTORS",
            36349: "MAX_FRAGMENT_UNIFORM_VECTORS",
            37440: "UNPACK_FLIP_Y_WEBGL",
            37441: "UNPACK_PREMULTIPLY_ALPHA_WEBGL",
            37442: "CONTEXT_LOST_WEBGL",
            37443: "UNPACK_COLORSPACE_CONVERSION_WEBGL",
            37444: "BROWSER_DEFAULT_WEBGL"
        }
    }
    , {}],
    26: [function(e, t, r) {
        var n = e("./1.0/numbers");
        t.exports = function(e) {
            return n[e]
        }
    }
    , {
        "./1.0/numbers": 25
    }],
    27: [function(e, t, r) {
        "use strict";
        var s = e("gl-texture2d");
        t.exports = function(e, t, r, n) {
            f || (f = e.FRAMEBUFFER_UNSUPPORTED,
            l = e.FRAMEBUFFER_INCOMPLETE_ATTACHMENT,
            u = e.FRAMEBUFFER_INCOMPLETE_DIMENSIONS,
            h = e.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT);
            var i = e.getExtension("WEBGL_draw_buffers");
            !d && i && function(e, t) {
                var r = e.getParameter(t.MAX_COLOR_ATTACHMENTS_WEBGL);
                d = new Array(r + 1);
                for (var n = 0; n <= r; ++n) {
                    for (var i = new Array(r), o = 0; o < n; ++o)
                        i[o] = e.COLOR_ATTACHMENT0 + o;
                    for (o = n; o < r; ++o)
                        i[o] = e.NONE;
                    d[n] = i
                }
            }(e, i);
            Array.isArray(t) && (n = r,
            r = 0 | t[1],
            t = 0 | t[0]);
            if ("number" != typeof t)
                throw new Error("gl-fbo: Missing shape parameter");
            var o = e.getParameter(e.MAX_RENDERBUFFER_SIZE);
            if (t < 0 || o < t || r < 0 || o < r)
                throw new Error("gl-fbo: Parameters are too large for FBO");
            var a = 1;
            if ("color"in (n = n || {})) {
                if ((a = Math.max(0 | n.color, 0)) < 0)
                    throw new Error("gl-fbo: Must specify a nonnegative number of colors");
                if (1 < a) {
                    if (!i)
                        throw new Error("gl-fbo: Multiple draw buffer extension not supported");
                    if (a > e.getParameter(i.MAX_COLOR_ATTACHMENTS_WEBGL))
                        throw new Error("gl-fbo: Context does not support " + a + " draw buffers")
                }
            }
            var s = e.UNSIGNED_BYTE
              , c = e.getExtension("OES_texture_float");
            if (n.float && 0 < a) {
                if (!c)
                    throw new Error("gl-fbo: Context does not support floating point textures");
                s = e.FLOAT
            } else
                n.preferFloat && 0 < a && c && (s = e.FLOAT);
            o = !0;
            "depth"in n && (o = !!n.depth);
            c = !1;
            "stencil"in n && (c = !!n.stencil);
            return new _(e,t,r,s,a,o,c,i)
        }
        ;
        var f, l, u, h, d = null;
        function p(e) {
            return [e.getParameter(e.FRAMEBUFFER_BINDING), e.getParameter(e.RENDERBUFFER_BINDING), e.getParameter(e.TEXTURE_BINDING_2D)]
        }
        function v(e, t) {
            e.bindFramebuffer(e.FRAMEBUFFER, t[0]),
            e.bindRenderbuffer(e.RENDERBUFFER, t[1]),
            e.bindTexture(e.TEXTURE_2D, t[2])
        }
        function g(e) {
            switch (e) {
            case f:
                throw new Error("gl-fbo: Framebuffer unsupported");
            case l:
                throw new Error("gl-fbo: Framebuffer incomplete attachment");
            case u:
                throw new Error("gl-fbo: Framebuffer incomplete dimensions");
            case h:
                throw new Error("gl-fbo: Framebuffer incomplete missing attachment");
            default:
                throw new Error("gl-fbo: Framebuffer failed for unspecified reason")
            }
        }
        function y(e, t, r, n, i, o) {
            if (!n)
                return null;
            var a = s(e, t, r, i, n);
            return a.magFilter = e.NEAREST,
            a.minFilter = e.NEAREST,
            a.mipSamples = 1,
            a.bind(),
            e.framebufferTexture2D(e.FRAMEBUFFER, o, e.TEXTURE_2D, a.handle, 0),
            a
        }
        function m(e, t, r, n, i) {
            var o = e.createRenderbuffer();
            return e.bindRenderbuffer(e.RENDERBUFFER, o),
            e.renderbufferStorage(e.RENDERBUFFER, n, t, r),
            e.framebufferRenderbuffer(e.FRAMEBUFFER, i, e.RENDERBUFFER, o),
            o
        }
        function _(e, t, r, n, i, o, a, s) {
            this.gl = e,
            this._shape = [0 | t, 0 | r],
            this._destroyed = !1,
            this._ext = s,
            this.color = new Array(i);
            for (var c = 0; c < i; ++c)
                this.color[c] = null;
            this._color_rb = null,
            this.depth = null,
            this._depth_rb = null,
            this._colorType = n,
            this._useDepth = o,
            this._useStencil = a;
            var f = this
              , l = [0 | t, 0 | r];
            Object.defineProperties(l, {
                0: {
                    get: function() {
                        return f._shape[0]
                    },
                    set: function(e) {
                        return f.width = e
                    }
                },
                1: {
                    get: function() {
                        return f._shape[1]
                    },
                    set: function(e) {
                        return f.height = e
                    }
                }
            }),
            this._shapeVector = l,
            function(e) {
                var t = p(e.gl)
                  , r = e.gl
                  , n = e.handle = r.createFramebuffer()
                  , i = e._shape[0]
                  , o = e._shape[1]
                  , a = e.color.length
                  , s = e._ext
                  , c = e._useStencil
                  , f = e._useDepth
                  , l = e._colorType;
                r.bindFramebuffer(r.FRAMEBUFFER, n);
                for (var u = 0; u < a; ++u)
                    e.color[u] = y(r, i, o, l, r.RGBA, r.COLOR_ATTACHMENT0 + u);
                if (0 === a ? (e._color_rb = m(r, i, o, r.RGBA4, r.COLOR_ATTACHMENT0),
                s && s.drawBuffersWEBGL(d[0])) : 1 < a && s.drawBuffersWEBGL(d[a]),
                (s = r.getExtension("WEBGL_depth_texture")) ? c ? e.depth = y(r, i, o, s.UNSIGNED_INT_24_8_WEBGL, r.DEPTH_STENCIL, r.DEPTH_STENCIL_ATTACHMENT) : f && (e.depth = y(r, i, o, r.UNSIGNED_SHORT, r.DEPTH_COMPONENT, r.DEPTH_ATTACHMENT)) : f && c ? e._depth_rb = m(r, i, o, r.DEPTH_STENCIL, r.DEPTH_STENCIL_ATTACHMENT) : f ? e._depth_rb = m(r, i, o, r.DEPTH_COMPONENT16, r.DEPTH_ATTACHMENT) : c && (e._depth_rb = m(r, i, o, r.STENCIL_INDEX, r.STENCIL_ATTACHMENT)),
                (c = r.checkFramebufferStatus(r.FRAMEBUFFER)) !== r.FRAMEBUFFER_COMPLETE) {
                    e._destroyed = !0,
                    r.bindFramebuffer(r.FRAMEBUFFER, null),
                    r.deleteFramebuffer(e.handle),
                    e.handle = null,
                    e.depth && (e.depth.dispose(),
                    e.depth = null),
                    e._depth_rb && (r.deleteRenderbuffer(e._depth_rb),
                    e._depth_rb = null);
                    for (u = 0; u < e.color.length; ++u)
                        e.color[u].dispose(),
                        e.color[u] = null;
                    e._color_rb && (r.deleteRenderbuffer(e._color_rb),
                    e._color_rb = null),
                    v(r, t),
                    g(c)
                }
                v(r, t)
            }(this)
        }
        var n = _.prototype;
        function i(e, t, r) {
            if (e._destroyed)
                throw new Error("gl-fbo: Can't resize destroyed FBO");
            if (e._shape[0] !== t || e._shape[1] !== r) {
                var n = e.gl
                  , i = n.getParameter(n.MAX_RENDERBUFFER_SIZE);
                if (t < 0 || i < t || r < 0 || i < r)
                    throw new Error("gl-fbo: Can't resize FBO, invalid dimensions");
                e._shape[0] = t,
                e._shape[1] = r;
                for (var o = p(n), a = 0; a < e.color.length; ++a)
                    e.color[a].shape = e._shape;
                e._color_rb && (n.bindRenderbuffer(n.RENDERBUFFER, e._color_rb),
                n.renderbufferStorage(n.RENDERBUFFER, n.RGBA4, e._shape[0], e._shape[1])),
                e.depth && (e.depth.shape = e._shape),
                e._depth_rb && (n.bindRenderbuffer(n.RENDERBUFFER, e._depth_rb),
                e._useDepth && e._useStencil ? n.renderbufferStorage(n.RENDERBUFFER, n.DEPTH_STENCIL, e._shape[0], e._shape[1]) : e._useDepth ? n.renderbufferStorage(n.RENDERBUFFER, n.DEPTH_COMPONENT16, e._shape[0], e._shape[1]) : e._useStencil && n.renderbufferStorage(n.RENDERBUFFER, n.STENCIL_INDEX, e._shape[0], e._shape[1])),
                n.bindFramebuffer(n.FRAMEBUFFER, e.handle);
                i = n.checkFramebufferStatus(n.FRAMEBUFFER);
                i !== n.FRAMEBUFFER_COMPLETE && (e.dispose(),
                v(n, o),
                g(i)),
                v(n, o)
            }
        }
        Object.defineProperties(n, {
            shape: {
                get: function() {
                    return this._destroyed ? [0, 0] : this._shapeVector
                },
                set: function(e) {
                    if (2 !== (e = !Array.isArray(e) ? [0 | e, 0 | e] : e).length)
                        throw new Error("gl-fbo: Shape vector must be length 2");
                    var t = 0 | e[0]
                      , r = 0 | e[1];
                    return i(this, t, r),
                    [t, r]
                },
                enumerable: !1
            },
            width: {
                get: function() {
                    return this._destroyed ? 0 : this._shape[0]
                },
                set: function(e) {
                    return i(this, e |= 0, this._shape[1]),
                    e
                },
                enumerable: !1
            },
            height: {
                get: function() {
                    return this._destroyed ? 0 : this._shape[1]
                },
                set: function(e) {
                    return i(this, this._shape[0], e |= 0),
                    e
                },
                enumerable: !1
            }
        }),
        n.bind = function() {
            var e;
            this._destroyed || ((e = this.gl).bindFramebuffer(e.FRAMEBUFFER, this.handle),
            e.viewport(0, 0, this._shape[0], this._shape[1]))
        }
        ,
        n.dispose = function() {
            if (!this._destroyed) {
                this._destroyed = !0;
                var e = this.gl;
                e.deleteFramebuffer(this.handle),
                this.handle = null,
                this.depth && (this.depth.dispose(),
                this.depth = null),
                this._depth_rb && (e.deleteRenderbuffer(this._depth_rb),
                this._depth_rb = null);
                for (var t = 0; t < this.color.length; ++t)
                    this.color[t].dispose(),
                    this.color[t] = null;
                this._color_rb && (e.deleteRenderbuffer(this._color_rb),
                this._color_rb = null)
            }
        }
    }
    , {
        "gl-texture2d": 38
    }],
    28: [function(e, t, r) {
        var d = e("sprintf-js").sprintf
          , p = e("gl-constants/lookup")
          , v = e("glsl-shader-name")
          , g = e("add-line-numbers");
        t.exports = function(e, t, r) {
            "use strict";
            var n = v(t) || "of unknown name (see npm glsl-shader-name)"
              , i = "unknown type";
            void 0 !== r && (i = r === p.FRAGMENT_SHADER ? "fragment" : "vertex");
            for (var o = d("Error compiling %s shader %s:\n", i, n), n = d("%s%s", o, e), a = e.split("\n"), s = {}, c = 0; c < a.length; c++) {
                var f = a[c];
                if ("" !== f && "\0" !== f) {
                    var l = parseInt(f.split(":")[2]);
                    if (isNaN(l))
                        throw new Error(d("Could not parse error: %s", f));
                    s[l] = f
                }
            }
            for (var u = g(t).split("\n"), c = 0; c < u.length; c++) {
                var h;
                (s[c + 3] || s[c + 2] || s[c + 1]) && (h = u[c],
                o += h + "\n",
                s[c + 1] && (h = (h = s[c + 1]).substr(h.split(":", 3).join(":").length + 1).trim(),
                o += d("^^^ %s\n\n", h)))
            }
            return {
                long: o.trim(),
                short: n.trim()
            }
        }
    }
    , {
        "add-line-numbers": 9,
        "gl-constants/lookup": 26,
        "glsl-shader-name": 43,
        "sprintf-js": 67
    }],
    29: [function(e, t, r) {
        var n = e("./state");
        t.exports = function(o) {
            var e = ["Buffer", "Framebuffer", "Renderbuffer", "Program", "Shader", "Texture"].map(function(e) {
                var t = "delete" + e
                  , r = "create" + e
                  , n = o[r]
                  , i = [];
                return o[r] = function() {
                    var e = n.apply(this, arguments);
                    return i.push(e),
                    e
                }
                ,
                {
                    remove: t,
                    handles: i
                }
            });
            return function() {
                return e.forEach(function(e) {
                    for (var t = 0; t < e.handles.length; t++)
                        o[e.remove].call(o, e.handles[t])
                }),
                n(o),
                o
            }
        }
        ,
        t.exports.state = n
    }
    , {
        "./state": 30
    }],
    30: [function(e, t, r) {
        t.exports = function(e) {
            var t = e.getParameter(e.MAX_VERTEX_ATTRIBS)
              , r = e.createBuffer();
            e.bindBuffer(e.ARRAY_BUFFER, r);
            for (var n = 0; n < t; ++n)
                e.disableVertexAttribArray(n),
                e.vertexAttribPointer(n, 4, e.FLOAT, !1, 0, 0),
                e.vertexAttrib1f(n, 0);
            e.deleteBuffer(r);
            for (var i = e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS), n = 0; n < i; ++n)
                e.activeTexture(e.TEXTURE0 + n),
                e.bindTexture(e.TEXTURE_CUBE_MAP, null),
                e.bindTexture(e.TEXTURE_2D, null);
            return e.activeTexture(e.TEXTURE0),
            e.useProgram(null),
            e.bindBuffer(e.ARRAY_BUFFER, null),
            e.bindBuffer(e.ELEMENT_ARRAY_BUFFER, null),
            e.bindFramebuffer(e.FRAMEBUFFER, null),
            e.bindRenderbuffer(e.RENDERBUFFER, null),
            e.disable(e.BLEND),
            e.disable(e.CULL_FACE),
            e.disable(e.DEPTH_TEST),
            e.disable(e.DITHER),
            e.disable(e.SCISSOR_TEST),
            e.blendColor(0, 0, 0, 0),
            e.blendEquation(e.FUNC_ADD),
            e.blendFunc(e.ONE, e.ZERO),
            e.clearColor(0, 0, 0, 0),
            e.clearDepth(1),
            e.clearStencil(-1),
            e.colorMask(!0, !0, !0, !0),
            e.cullFace(e.BACK),
            e.depthFunc(e.LESS),
            e.depthMask(!0),
            e.depthRange(0, 1),
            e.frontFace(e.CCW),
            e.hint(e.GENERATE_MIPMAP_HINT, e.DONT_CARE),
            e.lineWidth(1),
            e.pixelStorei(e.PACK_ALIGNMENT, 4),
            e.pixelStorei(e.UNPACK_ALIGNMENT, 4),
            e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL, !1),
            e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !1),
            e.polygonOffset(0, 0),
            e.sampleCoverage(1, !1),
            e.scissor(0, 0, e.canvas.width, e.canvas.height),
            e.stencilFunc(e.ALWAYS, 0, 4294967295),
            e.stencilMask(4294967295),
            e.stencilOp(e.KEEP, e.KEEP, e.KEEP),
            e.viewport(0, 0, e.canvas.width, e.canvas.height),
            e.clear(e.COLOR_BUFFER_BIT | e.DEPTH_BUFFER_BIT | e.STENCIL_BUFFER_BIT),
            e
        }
    }
    , {}],
    31: [function(e, t, r) {
        "use strict";
        var _ = e("./lib/create-uniforms")
          , x = e("./lib/create-attributes")
          , b = e("./lib/reflect")
          , E = e("./lib/shader-cache")
          , w = e("./lib/runtime-reflect")
          , T = e("./lib/GLError");
        function a(e) {
            this.gl = e,
            this.gl.lastAttribCount = 0,
            this._vref = this._fref = this._relink = this.vertShader = this.fragShader = this.program = this.attributes = this.uniforms = this.types = null
        }
        var n = a.prototype;
        function A(e, t) {
            return e.name < t.name ? -1 : 1
        }
        n.bind = function() {
            var e;
            this.program || this._relink();
            var t = this.gl.getProgramParameter(this.program, this.gl.ACTIVE_ATTRIBUTES)
              , r = this.gl.lastAttribCount;
            if (r < t)
                for (e = r; e < t; e++)
                    this.gl.enableVertexAttribArray(e);
            else if (t < r)
                for (e = t; e < r; e++)
                    this.gl.disableVertexAttribArray(e);
            this.gl.lastAttribCount = t,
            this.gl.useProgram(this.program)
        }
        ,
        n.dispose = function() {
            for (var e = this.gl.lastAttribCount, t = 0; t < e; t++)
                this.gl.disableVertexAttribArray(t);
            this.gl.lastAttribCount = 0,
            this._fref && this._fref.dispose(),
            this._vref && this._vref.dispose(),
            this.attributes = this.types = this.vertShader = this.fragShader = this.program = this._relink = this._fref = this._vref = null
        }
        ,
        n.update = function(e, t, r, n) {
            t && 1 !== arguments.length || (e = (s = e).vertex,
            t = s.fragment,
            r = s.uniforms,
            n = s.attributes);
            var i = this
              , o = i.gl
              , a = i._vref;
            i._vref = E.shader(o, o.VERTEX_SHADER, e),
            a && a.dispose(),
            i.vertShader = i._vref.shader;
            var s = this._fref;
            if (i._fref = E.shader(o, o.FRAGMENT_SHADER, t),
            s && s.dispose(),
            i.fragShader = i._fref.shader,
            !r || !n) {
                a = o.createProgram();
                if (o.attachShader(a, i.fragShader),
                o.attachShader(a, i.vertShader),
                o.linkProgram(a),
                !o.getProgramParameter(a, o.LINK_STATUS)) {
                    s = o.getProgramInfoLog(a);
                    throw new T(s,"Error linking program:" + s)
                }
                r = r || w.uniforms(o, a),
                n = n || w.attributes(o, a),
                o.deleteProgram(a)
            }
            (n = n.slice()).sort(A);
            for (var c = [], f = [], l = [], u = 0; u < n.length; ++u) {
                var h = n[u];
                if (0 <= h.type.indexOf("mat")) {
                    for (var d = 0 | h.type.charAt(h.type.length - 1), p = new Array(d), v = 0; v < d; ++v)
                        p[v] = l.length,
                        f.push(h.name + "[" + v + "]"),
                        "number" == typeof h.location ? l.push(h.location + v) : Array.isArray(h.location) && h.location.length === d && "number" == typeof h.location[v] ? l.push(0 | h.location[v]) : l.push(-1);
                    c.push({
                        name: h.name,
                        type: h.type,
                        locations: p
                    })
                } else
                    c.push({
                        name: h.name,
                        type: h.type,
                        locations: [l.length]
                    }),
                    f.push(h.name),
                    "number" == typeof h.location ? l.push(0 | h.location) : l.push(-1)
            }
            var g = 0;
            for (u = 0; u < l.length; ++u)
                if (l[u] < 0) {
                    for (; 0 <= l.indexOf(g); )
                        g += 1;
                    l[u] = g
                }
            var y = new Array(r.length);
            function m() {
                i.program = E.program(o, i._vref, i._fref, f, l);
                for (var e = 0; e < r.length; ++e)
                    y[e] = o.getUniformLocation(i.program, r[e].name)
            }
            m(),
            i._relink = m,
            i.types = {
                uniforms: b(r),
                attributes: b(n)
            },
            i.attributes = x(o, i, c, l),
            Object.defineProperty(i, "uniforms", _(o, i, r, y))
        }
        ,
        t.exports = function(e, t, r, n, i) {
            var o = new a(e);
            return o.update(t, r, n, i),
            o
        }
    }
    , {
        "./lib/GLError": 32,
        "./lib/create-attributes": 33,
        "./lib/create-uniforms": 34,
        "./lib/reflect": 35,
        "./lib/runtime-reflect": 36,
        "./lib/shader-cache": 37
    }],
    32: [function(e, t, r) {
        function n(e, t, r) {
            this.shortMessage = t || "",
            this.longMessage = r || "",
            this.rawError = e || "",
            this.message = "gl-shader: " + (t || e || "") + (r ? "\n" + r : ""),
            this.stack = (new Error).stack
        }
        (n.prototype = new Error).name = "GLError",
        t.exports = n.prototype.constructor = n
    }
    , {}],
    33: [function(e, t, r) {
        "use strict";
        t.exports = function(e, t, r, n) {
            for (var i = {}, o = 0, a = r.length; o < a; ++o) {
                var s, c = r[o], f = c.name, l = c.type, u = c.locations;
                switch (l) {
                case "bool":
                case "int":
                case "float":
                    d(e, t, u[0], n, 1, i, f);
                    break;
                default:
                    if (0 <= l.indexOf("vec")) {
                        if ((s = l.charCodeAt(l.length - 1) - 48) < 2 || 4 < s)
                            throw new h("","Invalid data type for attribute " + f + ": " + l);
                        d(e, t, u[0], n, s, i, f)
                    } else {
                        if (!(0 <= l.indexOf("mat")))
                            throw new h("","Unknown data type for attribute " + f + ": " + l);
                        if ((s = l.charCodeAt(l.length - 1) - 48) < 2 || 4 < s)
                            throw new h("","Invalid data type for attribute " + f + ": " + l);
                        !function(a, e, s, c, f, t, r) {
                            for (var n = new Array(f), i = new Array(f), o = 0; o < f; ++o)
                                d(a, e, s[o], c, f, n, o),
                                i[o] = n[o];
                            Object.defineProperty(n, "location", {
                                set: function(e) {
                                    if (Array.isArray(e))
                                        for (var t = 0; t < f; ++t)
                                            i[t].location = e[t];
                                    else
                                        for (t = 0; t < f; ++t)
                                            i[t].location = e + t;
                                    return e
                                },
                                get: function() {
                                    for (var e = new Array(f), t = 0; t < f; ++t)
                                        e[t] = c[s[t]];
                                    return e
                                },
                                enumerable: !0
                            }),
                            n.pointer = function(e, t, r, n) {
                                e = e || a.FLOAT,
                                t = !!t,
                                r = r || f * f,
                                n = n || 0;
                                for (var i = 0; i < f; ++i) {
                                    var o = c[s[i]];
                                    a.vertexAttribPointer(o, f, e, t, r, n + i * f),
                                    a.enableVertexAttribArray(o)
                                }
                            }
                            ;
                            var l = new Array(f)
                              , u = a["vertexAttrib" + f + "fv"];
                            Object.defineProperty(t, r, {
                                set: function(e) {
                                    for (var t = 0; t < f; ++t) {
                                        var r = c[s[t]];
                                        if (a.disableVertexAttribArray(r),
                                        Array.isArray(e[0]))
                                            u.call(a, r, e[t]);
                                        else {
                                            for (var n = 0; n < f; ++n)
                                                l[n] = e[f * t + n];
                                            u.call(a, r, l)
                                        }
                                    }
                                    return e
                                },
                                get: function() {
                                    return n
                                },
                                enumerable: !0
                            })
                        }(e, t, u, n, s, i, f)
                    }
                }
            }
            return i
        }
        ;
        var h = e("./GLError");
        function f(e, t, r, n, i, o) {
            this._gl = e,
            this._wrapper = t,
            this._index = r,
            this._locations = n,
            this._dimension = i,
            this._constFunc = o
        }
        var n = f.prototype;
        n.pointer = function(e, t, r, n) {
            var i = this._gl
              , o = this._locations[this._index];
            i.vertexAttribPointer(o, this._dimension, e || i.FLOAT, !!t, r || 0, n || 0),
            i.enableVertexAttribArray(o)
        }
        ,
        n.set = function(e, t, r, n) {
            return this._constFunc(this._locations[this._index], e, t, r, n)
        }
        ,
        Object.defineProperty(n, "location", {
            get: function() {
                return this._locations[this._index]
            },
            set: function(e) {
                return e !== this._locations[this._index] && (this._locations[this._index] = 0 | e,
                this._wrapper.program = null),
                0 | e
            }
        });
        var l = [function(e, t, r) {
            return void 0 === r.length ? e.vertexAttrib1f(t, r) : e.vertexAttrib1fv(t, r)
        }
        , function(e, t, r, n) {
            return void 0 === r.length ? e.vertexAttrib2f(t, r, n) : e.vertexAttrib2fv(t, r)
        }
        , function(e, t, r, n, i) {
            return void 0 === r.length ? e.vertexAttrib3f(t, r, n, i) : e.vertexAttrib3fv(t, r)
        }
        , function(e, t, r, n, i, o) {
            return void 0 === r.length ? e.vertexAttrib4f(t, r, n, i, o) : e.vertexAttrib4fv(t, r)
        }
        ];
        function d(t, e, r, n, i, o, a) {
            var s = l[i]
              , c = new f(t,e,r,n,i,s);
            Object.defineProperty(o, a, {
                set: function(e) {
                    return t.disableVertexAttribArray(n[r]),
                    s(t, n[r], e),
                    e
                },
                get: function() {
                    return c
                },
                enumerable: !0
            })
        }
    }
    , {
        "./GLError": 32
    }],
    34: [function(e, t, r) {
        "use strict";
        var n = e("./reflect")
          , v = e("./GLError");
        function s(e) {
            return function() {
                return e
            }
        }
        function c(e, t) {
            for (var r = new Array(e), n = 0; n < e; ++n)
                r[n] = t;
            return r
        }
        t.exports = function(h, e, d, p) {
            function o(u) {
                return function(e) {
                    for (var t = function e(t, r) {
                        if ("object" != typeof r)
                            return [[t, r]];
                        var n = [];
                        for (var i in r) {
                            var o = r[i]
                              , a = t;
                            parseInt(i) + "" === i ? a += "[" + i + "]" : a += "." + i,
                            "object" == typeof o ? n.push.apply(n, e(a, o)) : n.push([a, o])
                        }
                        return n
                    }("", u), r = 0; r < t.length; ++r) {
                        var n = t[r]
                          , i = n[0]
                          , o = n[1];
                        if (p[o]) {
                            var a, s = e;
                            "string" != typeof i || 0 !== i.indexOf(".") && 0 !== i.indexOf("[") || (s = (a = 0 === (a = i).indexOf(".") ? i.slice(1) : a).indexOf("]") === a.length - 1 ? (n = a.indexOf("["),
                            i = a.slice(0, n),
                            n = a.slice(n + 1, a.length - 1),
                            (i ? e[i] : e)[n]) : e[a]);
                            var c, f = d[o].type;
                            switch (f) {
                            case "bool":
                            case "int":
                            case "sampler2D":
                            case "samplerCube":
                                h.uniform1i(p[o], s);
                                break;
                            case "float":
                                h.uniform1f(p[o], s);
                                break;
                            default:
                                var l = f.indexOf("vec");
                                if (!(0 <= l && l <= 1 && f.length === 4 + l)) {
                                    if (0 !== f.indexOf("mat") || 4 !== f.length)
                                        throw new v("","Unknown uniform data type for " + name + ": " + f);
                                    if ((c = f.charCodeAt(f.length - 1) - 48) < 2 || 4 < c)
                                        throw new v("","Invalid uniform dimension type for matrix " + name + ": " + f);
                                    h["uniformMatrix" + c + "fv"](p[o], !1, s);
                                    break
                                }
                                if ((c = f.charCodeAt(f.length - 1) - 48) < 2 || 4 < c)
                                    throw new v("","Invalid data type");
                                switch (f.charAt(0)) {
                                case "b":
                                case "i":
                                    h["uniform" + c + "iv"](p[o], s);
                                    break;
                                case "v":
                                    h["uniform" + c + "fv"](p[o], s);
                                    break;
                                default:
                                    throw new v("","Unrecognized data type for vector " + name + ": " + f)
                                }
                            }
                        }
                    }
                }
            }
            function i(e, t, r) {
                var n, i;
                "object" == typeof r ? (n = a(r),
                Object.defineProperty(e, t, {
                    get: s(n),
                    set: o(r),
                    enumerable: !0,
                    configurable: !1
                })) : p[r] ? Object.defineProperty(e, t, {
                    get: function(e, t, r) {
                        return e.getUniform(t.program, r[i])
                    },
                    set: o(i = r),
                    enumerable: !0,
                    configurable: !1
                }) : e[t] = function(e) {
                    switch (e) {
                    case "bool":
                        return !1;
                    case "int":
                    case "sampler2D":
                    case "samplerCube":
                    case "float":
                        return 0;
                    default:
                        var t, r = e.indexOf("vec");
                        if (0 <= r && r <= 1 && e.length === 4 + r) {
                            if ((t = e.charCodeAt(e.length - 1) - 48) < 2 || 4 < t)
                                throw new v("","Invalid data type");
                            return "b" === e.charAt(0) ? c(t, !1) : c(t, 0)
                        }
                        if (0 !== e.indexOf("mat") || 4 !== e.length)
                            throw new v("","Unknown uniform data type for " + name + ": " + e);
                        if ((t = e.charCodeAt(e.length - 1) - 48) < 2 || 4 < t)
                            throw new v("","Invalid uniform dimension type for matrix " + name + ": " + e);
                        return c(t * t, 0)
                    }
                }(d[r].type)
            }
            function a(e) {
                if (Array.isArray(e))
                    for (var t = new Array(e.length), r = 0; r < e.length; ++r)
                        i(t, r, e[r]);
                else
                    for (var n in t = {},
                    e)
                        i(t, n, e[n]);
                return t
            }
            var t = n(d, !0);
            return {
                get: s(a(t)),
                set: o(t),
                enumerable: !0,
                configurable: !0
            }
        }
    }
    , {
        "./GLError": 32,
        "./reflect": 35
    }],
    35: [function(e, t, r) {
        "use strict";
        t.exports = function(e, t) {
            for (var r = {}, n = 0; n < e.length; ++n)
                for (var i = e[n].name.split("."), o = r, a = 0; a < i.length; ++a) {
                    var s = i[a].split("[");
                    if (1 < s.length) {
                        s[0]in o || (o[s[0]] = []),
                        o = o[s[0]];
                        for (var c = 1; c < s.length; ++c) {
                            var f = parseInt(s[c]);
                            c < s.length - 1 || a < i.length - 1 ? (f in o || (c < s.length - 1 ? o[f] = [] : o[f] = {}),
                            o = o[f]) : o[f] = t ? n : e[n].type
                        }
                    } else
                        a < i.length - 1 ? (s[0]in o || (o[s[0]] = {}),
                        o = o[s[0]]) : o[s[0]] = t ? n : e[n].type
                }
            return r
        }
    }
    , {}],
    36: [function(e, t, r) {
        "use strict";
        r.uniforms = function(e, t) {
            for (var r = e.getProgramParameter(t, e.ACTIVE_UNIFORMS), n = [], i = 0; i < r; ++i) {
                var o = e.getActiveUniform(t, i);
                if (o) {
                    var a = c(e, o.type);
                    if (1 < o.size)
                        for (var s = 0; s < o.size; ++s)
                            n.push({
                                name: o.name.replace("[0]", "[" + s + "]"),
                                type: a
                            });
                    else
                        n.push({
                            name: o.name,
                            type: a
                        })
                }
            }
            return n
        }
        ,
        r.attributes = function(e, t) {
            for (var r = e.getProgramParameter(t, e.ACTIVE_ATTRIBUTES), n = [], i = 0; i < r; ++i) {
                var o = e.getActiveAttrib(t, i);
                o && n.push({
                    name: o.name,
                    type: c(e, o.type)
                })
            }
            return n
        }
        ;
        var o = {
            FLOAT: "float",
            FLOAT_VEC2: "vec2",
            FLOAT_VEC3: "vec3",
            FLOAT_VEC4: "vec4",
            INT: "int",
            INT_VEC2: "ivec2",
            INT_VEC3: "ivec3",
            INT_VEC4: "ivec4",
            BOOL: "bool",
            BOOL_VEC2: "bvec2",
            BOOL_VEC3: "bvec3",
            BOOL_VEC4: "bvec4",
            FLOAT_MAT2: "mat2",
            FLOAT_MAT3: "mat3",
            FLOAT_MAT4: "mat4",
            SAMPLER_2D: "sampler2D",
            SAMPLER_CUBE: "samplerCube"
        }
          , a = null;
        function c(e, t) {
            if (!a) {
                var r = Object.keys(o);
                a = {};
                for (var n = 0; n < r.length; ++n) {
                    var i = r[n];
                    a[e[i]] = o[i]
                }
            }
            return a[t]
        }
    }
    , {}],
    37: [function(e, t, r) {
        "use strict";
        r.shader = function(e, t, r) {
            return l(e).getShaderReference(t, r)
        }
        ,
        r.program = function(e, t, r, n, i) {
            return l(e).getProgram(t, r, n, i)
        }
        ;
        var c = e("./GLError")
          , o = e("gl-format-compiler-error")
          , n = new ("undefined" == typeof WeakMap ? e("weakmap-shim") : WeakMap)
          , a = 0;
        function s(e, t, r, n, i, o, a) {
            this.id = e,
            this.src = t,
            this.type = r,
            this.shader = n,
            this.count = o,
            this.programs = [],
            this.cache = a
        }
        function i(e) {
            this.gl = e,
            this.shaders = [{}, {}],
            this.programs = {}
        }
        s.prototype.dispose = function() {
            if (0 == --this.count) {
                for (var e = this.cache, t = e.gl, r = this.programs, n = 0, i = r.length; n < i; ++n) {
                    var o = e.programs[r[n]];
                    o && (delete e.programs[n],
                    t.deleteProgram(o))
                }
                t.deleteShader(this.shader),
                delete e.shaders[this.type === t.FRAGMENT_SHADER | 0][this.src]
            }
        }
        ;
        var f = i.prototype;
        function l(e) {
            var t = n.get(e);
            return t || (t = new i(e),
            n.set(e, t)),
            t
        }
        f.getShaderReference = function(e, t) {
            var r = this.gl
              , n = this.shaders[e === r.FRAGMENT_SHADER | 0]
              , i = n[t];
            return i && r.isShader(i.shader) ? i.count += 1 : (r = function(e, t, r) {
                var n = e.createShader(t);
                if (e.shaderSource(n, r),
                e.compileShader(n),
                e.getShaderParameter(n, e.COMPILE_STATUS))
                    return n;
                n = e.getShaderInfoLog(n);
                try {
                    var i = o(n, r, t)
                } catch (e) {
                    throw console.warn("Failed to format compiler error: " + e),
                    new c(n,"Error compiling shader:\n" + n)
                }
                throw new c(n,i.short,i.long)
            }(r, e, t),
            i = n[t] = new s(a++,t,e,r,0,1,this)),
            i
        }
        ,
        f.getProgram = function(e, t, r, n) {
            var i = [e.id, t.id, r.join(":"), n.join(":")].join("@")
              , o = this.programs[i];
            return o && this.gl.isProgram(o) || (this.programs[i] = o = function(e, t, r, n, i) {
                var o = e.createProgram();
                e.attachShader(o, t),
                e.attachShader(o, r);
                for (var a = 0; a < n.length; ++a)
                    e.bindAttribLocation(o, i[a], n[a]);
                if (e.linkProgram(o),
                e.getProgramParameter(o, e.LINK_STATUS))
                    return o;
                var s = e.getProgramInfoLog(o);
                throw new c(s,"Error linking program: " + s)
            }(this.gl, e.shader, t.shader, r, n),
            e.programs.push(i),
            t.programs.push(i)),
            o
        }
    }
    , {
        "./GLError": 32,
        "gl-format-compiler-error": 28,
        "weakmap-shim": 73
    }],
    38: [function(e, t, r) {
        "use strict";
        var p = e("ndarray")
          , v = e("ndarray-ops")
          , g = e("typedarray-pool");
        t.exports = function(e) {
            if (arguments.length <= 1)
                throw new Error("gl-texture2d: Missing arguments for texture2d constructor");
            n || function(e) {
                n = [e.LINEAR, e.NEAREST_MIPMAP_LINEAR, e.LINEAR_MIPMAP_NEAREST, e.LINEAR_MIPMAP_NEAREST],
                i = [e.NEAREST, e.LINEAR, e.NEAREST_MIPMAP_NEAREST, e.NEAREST_MIPMAP_LINEAR, e.LINEAR_MIPMAP_NEAREST, e.LINEAR_MIPMAP_LINEAR],
                o = [e.REPEAT, e.CLAMP_TO_EDGE, e.MIRRORED_REPEAT]
            }(e);
            if ("number" == typeof arguments[1])
                return f(e, arguments[1], arguments[2], arguments[3] || e.RGBA, arguments[4] || e.UNSIGNED_BYTE);
            if (Array.isArray(arguments[1]))
                return f(e, 0 | arguments[1][0], 0 | arguments[1][1], arguments[2] || e.RGBA, arguments[3] || e.UNSIGNED_BYTE);
            if ("object" == typeof arguments[1]) {
                var t = arguments[1]
                  , r = a(t) ? t : t.raw;
                if (r)
                    return function(e, t, r, n, i, o) {
                        var a = u(e);
                        return e.texImage2D(e.TEXTURE_2D, 0, i, i, o, t),
                        new l(e,a,r,n,i,o)
                    }(e, r, 0 | t.width, 0 | t.height, arguments[2] || e.RGBA, arguments[3] || e.UNSIGNED_BYTE);
                if (t.shape && t.data && t.stride)
                    return function(e, t) {
                        var r = t.dtype
                          , n = t.shape.slice()
                          , i = e.getParameter(e.MAX_TEXTURE_SIZE);
                        if (n[0] < 0 || n[0] > i || n[1] < 0 || n[1] > i)
                            throw new Error("gl-texture2d: Invalid texture size");
                        var o = m(n, t.stride.slice())
                          , a = 0;
                        "float32" === r ? a = e.FLOAT : "float64" === r ? (a = e.FLOAT,
                        o = !1,
                        r = "float32") : "uint8" === r ? a = e.UNSIGNED_BYTE : (a = e.UNSIGNED_BYTE,
                        o = !1,
                        r = "uint8");
                        var s, c = 0;
                        if (2 === n.length)
                            c = e.LUMINANCE,
                            n = [n[0], n[1], 1],
                            t = p(t.data, n, [t.stride[0], t.stride[1], 1], t.offset);
                        else {
                            if (3 !== n.length)
                                throw new Error("gl-texture2d: Invalid shape for texture");
                            if (1 === n[2])
                                c = e.ALPHA;
                            else if (2 === n[2])
                                c = e.LUMINANCE_ALPHA;
                            else if (3 === n[2])
                                c = e.RGB;
                            else {
                                if (4 !== n[2])
                                    throw new Error("gl-texture2d: Invalid shape for pixel coords");
                                c = e.RGBA
                            }
                        }
                        a !== e.FLOAT || e.getExtension("OES_texture_float") || (a = e.UNSIGNED_BYTE,
                        o = !1);
                        i = t.size;
                        {
                            var f;
                            f = o ? 0 === t.offset && t.data.length === i ? t.data : t.data.subarray(t.offset, t.offset + i) : (f = [n[2], n[2] * n[0], 1],
                            s = g.malloc(i, r),
                            f = p(s, n, f, 0),
                            "float32" !== r && "float64" !== r || a !== e.UNSIGNED_BYTE ? v.assign(f, t) : y(f, t),
                            s.subarray(0, i))
                        }
                        i = u(e);
                        e.texImage2D(e.TEXTURE_2D, 0, c, n[0], n[1], 0, c, a, f),
                        o || g.free(s);
                        return new l(e,i,n[0],n[1],c,a)
                    }(e, t)
            }
            throw new Error("gl-texture2d: Invalid arguments for texture2d constructor")
        }
        ;
        var n = null
          , i = null
          , o = null;
        function a(e) {
            return "undefined" != typeof HTMLCanvasElement && e instanceof HTMLCanvasElement || "undefined" != typeof HTMLImageElement && e instanceof HTMLImageElement || "undefined" != typeof HTMLVideoElement && e instanceof HTMLVideoElement || "undefined" != typeof ImageData && e instanceof ImageData
        }
        var y = function(e, t) {
            v.muls(e, t, 255)
        };
        function s(e, t, r) {
            var n = e.gl
              , i = n.getParameter(n.MAX_TEXTURE_SIZE);
            if (t < 0 || i < t || r < 0 || i < r)
                throw new Error("gl-texture2d: Invalid texture size");
            return e._shape = [t, r],
            e.bind(),
            n.texImage2D(n.TEXTURE_2D, 0, e.format, t, r, 0, e.format, e.type, null),
            e._mipLevels = [0],
            e
        }
        function l(e, t, r, n, i, o) {
            this.gl = e,
            this.handle = t,
            this.format = i,
            this.type = o,
            this._shape = [r, n],
            this._mipLevels = [0],
            this._magFilter = e.NEAREST,
            this._minFilter = e.NEAREST,
            this._wrapS = e.CLAMP_TO_EDGE,
            this._wrapT = e.CLAMP_TO_EDGE,
            this._anisoSamples = 1;
            var a = this
              , s = [this._wrapS, this._wrapT];
            Object.defineProperties(s, [{
                get: function() {
                    return a._wrapS
                },
                set: function(e) {
                    return a.wrapS = e
                }
            }, {
                get: function() {
                    return a._wrapT
                },
                set: function(e) {
                    return a.wrapT = e
                }
            }]),
            this._wrapVector = s;
            s = [this._shape[0], this._shape[1]];
            Object.defineProperties(s, [{
                get: function() {
                    return a._shape[0]
                },
                set: function(e) {
                    return a.width = e
                }
            }, {
                get: function() {
                    return a._shape[1]
                },
                set: function(e) {
                    return a.height = e
                }
            }]),
            this._shapeVector = s
        }
        var c = l.prototype;
        function m(e, t) {
            return 3 === e.length ? 1 === t[2] && t[1] === e[0] * e[2] && t[0] === e[2] : 1 === t[0] && t[1] === e[0]
        }
        function u(e) {
            var t = e.createTexture();
            return e.bindTexture(e.TEXTURE_2D, t),
            e.texParameteri(e.TEXTURE_2D, e.TEXTURE_MIN_FILTER, e.NEAREST),
            e.texParameteri(e.TEXTURE_2D, e.TEXTURE_MAG_FILTER, e.NEAREST),
            e.texParameteri(e.TEXTURE_2D, e.TEXTURE_WRAP_S, e.CLAMP_TO_EDGE),
            e.texParameteri(e.TEXTURE_2D, e.TEXTURE_WRAP_T, e.CLAMP_TO_EDGE),
            t
        }
        function f(e, t, r, n, i) {
            var o = e.getParameter(e.MAX_TEXTURE_SIZE);
            if (t < 0 || o < t || r < 0 || o < r)
                throw new Error("gl-texture2d: Invalid texture shape");
            if (i === e.FLOAT && !e.getExtension("OES_texture_float"))
                throw new Error("gl-texture2d: Floating point textures not supported on this platform");
            o = u(e);
            return e.texImage2D(e.TEXTURE_2D, 0, n, t, r, 0, n, i, null),
            new l(e,o,t,r,n,i)
        }
        Object.defineProperties(c, {
            minFilter: {
                get: function() {
                    return this._minFilter
                },
                set: function(e) {
                    this.bind();
                    var t = this.gl;
                    if (this.type === t.FLOAT && 0 <= n.indexOf(e) && (t.getExtension("OES_texture_float_linear") || (e = t.NEAREST)),
                    i.indexOf(e) < 0)
                        throw new Error("gl-texture2d: Unknown filter mode " + e);
                    return t.texParameteri(t.TEXTURE_2D, t.TEXTURE_MIN_FILTER, e),
                    this._minFilter = e
                }
            },
            magFilter: {
                get: function() {
                    return this._magFilter
                },
                set: function(e) {
                    this.bind();
                    var t = this.gl;
                    if (this.type === t.FLOAT && 0 <= n.indexOf(e) && (t.getExtension("OES_texture_float_linear") || (e = t.NEAREST)),
                    i.indexOf(e) < 0)
                        throw new Error("gl-texture2d: Unknown filter mode " + e);
                    return t.texParameteri(t.TEXTURE_2D, t.TEXTURE_MAG_FILTER, e),
                    this._magFilter = e
                }
            },
            mipSamples: {
                get: function() {
                    return this._anisoSamples
                },
                set: function(e) {
                    var t = this._anisoSamples;
                    return this._anisoSamples = 0 | Math.max(e, 1),
                    t === this._anisoSamples || (t = this.gl.getExtension("EXT_texture_filter_anisotropic")) && this.gl.texParameterf(this.gl.TEXTURE_2D, t.TEXTURE_MAX_ANISOTROPY_EXT, this._anisoSamples),
                    this._anisoSamples
                }
            },
            wrapS: {
                get: function() {
                    return this._wrapS
                },
                set: function(e) {
                    if (this.bind(),
                    o.indexOf(e) < 0)
                        throw new Error("gl-texture2d: Unknown wrap mode " + e);
                    return this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, e),
                    this._wrapS = e
                }
            },
            wrapT: {
                get: function() {
                    return this._wrapT
                },
                set: function(e) {
                    if (this.bind(),
                    o.indexOf(e) < 0)
                        throw new Error("gl-texture2d: Unknown wrap mode " + e);
                    return this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, e),
                    this._wrapT = e
                }
            },
            wrap: {
                get: function() {
                    return this._wrapVector
                },
                set: function(e) {
                    if (2 !== (e = !Array.isArray(e) ? [e, e] : e).length)
                        throw new Error("gl-texture2d: Must specify wrap mode for rows and columns");
                    for (var t = 0; t < 2; ++t)
                        if (o.indexOf(e[t]) < 0)
                            throw new Error("gl-texture2d: Unknown wrap mode " + e);
                    this._wrapS = e[0],
                    this._wrapT = e[1];
                    var r = this.gl;
                    return this.bind(),
                    r.texParameteri(r.TEXTURE_2D, r.TEXTURE_WRAP_S, this._wrapS),
                    r.texParameteri(r.TEXTURE_2D, r.TEXTURE_WRAP_T, this._wrapT),
                    e
                }
            },
            shape: {
                get: function() {
                    return this._shapeVector
                },
                set: function(e) {
                    if (Array.isArray(e)) {
                        if (2 !== e.length)
                            throw new Error("gl-texture2d: Invalid texture shape")
                    } else
                        e = [0 | e, 0 | e];
                    return s(this, 0 | e[0], 0 | e[1]),
                    [0 | e[0], 0 | e[1]]
                }
            },
            width: {
                get: function() {
                    return this._shape[0]
                },
                set: function(e) {
                    return s(this, e |= 0, this._shape[1]),
                    e
                }
            },
            height: {
                get: function() {
                    return this._shape[1]
                },
                set: function(e) {
                    return s(this, this._shape[0], e |= 0),
                    e
                }
            }
        }),
        c.bind = function(e) {
            var t = this.gl;
            return void 0 !== e && t.activeTexture(t.TEXTURE0 + (0 | e)),
            t.bindTexture(t.TEXTURE_2D, this.handle),
            void 0 !== e ? 0 | e : t.getParameter(t.ACTIVE_TEXTURE) - t.TEXTURE0
        }
        ,
        c.dispose = function() {
            this.gl.deleteTexture(this.handle)
        }
        ,
        c.generateMipmap = function() {
            this.bind(),
            this.gl.generateMipmap(this.gl.TEXTURE_2D);
            for (var e = Math.min(this._shape[0], this._shape[1]), t = 0; 0 < e; ++t,
            e >>>= 1)
                this._mipLevels.indexOf(t) < 0 && this._mipLevels.push(t)
        }
        ,
        c.setPixels = function(e, t, r, n) {
            var i = this.gl;
            this.bind(),
            Array.isArray(t) ? (n = r,
            r = 0 | t[1],
            t = 0 | t[0]) : (t = t || 0,
            r = r || 0),
            n = n || 0;
            var o = a(e) ? e : e.raw;
            if (o)
                this._mipLevels.indexOf(n) < 0 ? (i.texImage2D(i.TEXTURE_2D, 0, this.format, this.format, this.type, o),
                this._mipLevels.push(n)) : i.texSubImage2D(i.TEXTURE_2D, n, t, r, this.format, this.type, o);
            else {
                if (!(e.shape && e.stride && e.data))
                    throw new Error("gl-texture2d: Unsupported data type");
                if (e.shape.length < 2 || t + e.shape[1] > this._shape[1] >>> n || r + e.shape[0] > this._shape[0] >>> n || t < 0 || r < 0)
                    throw new Error("gl-texture2d: Texture dimensions are out of bounds");
                !function(e, t, r, n, i, o, a, s) {
                    var c = s.dtype
                      , f = s.shape.slice();
                    if (f.length < 2 || 3 < f.length)
                        throw new Error("gl-texture2d: Invalid ndarray, must be 2d or 3d");
                    var l = 0
                      , u = 0
                      , h = m(f, s.stride.slice());
                    "float32" === c ? l = e.FLOAT : "float64" === c ? (l = e.FLOAT,
                    h = !1,
                    c = "float32") : "uint8" === c ? l = e.UNSIGNED_BYTE : (l = e.UNSIGNED_BYTE,
                    h = !1,
                    c = "uint8");
                    if (2 === f.length)
                        u = e.LUMINANCE,
                        f = [f[0], f[1], 1],
                        s = p(s.data, f, [s.stride[0], s.stride[1], 1], s.offset);
                    else {
                        if (3 !== f.length)
                            throw new Error("gl-texture2d: Invalid shape for texture");
                        if (1 === f[2])
                            u = e.ALPHA;
                        else if (2 === f[2])
                            u = e.LUMINANCE_ALPHA;
                        else if (3 === f[2])
                            u = e.RGB;
                        else {
                            if (4 !== f[2])
                                throw new Error("gl-texture2d: Invalid shape for pixel coords");
                            u = e.RGBA
                        }
                        f[2]
                    }
                    u !== e.LUMINANCE && u !== e.ALPHA || i !== e.LUMINANCE && i !== e.ALPHA || (u = i);
                    if (u !== i)
                        throw new Error("gl-texture2d: Incompatible texture format for setPixels");
                    var d = s.size
                      , c = a.indexOf(n) < 0;
                    c && a.push(n);
                    l === o && h ? 0 === s.offset && s.data.length === d ? c ? e.texImage2D(e.TEXTURE_2D, n, i, f[0], f[1], 0, i, o, s.data) : e.texSubImage2D(e.TEXTURE_2D, n, t, r, f[0], f[1], i, o, s.data) : c ? e.texImage2D(e.TEXTURE_2D, n, i, f[0], f[1], 0, i, o, s.data.subarray(s.offset, s.offset + d)) : e.texSubImage2D(e.TEXTURE_2D, n, t, r, f[0], f[1], i, o, s.data.subarray(s.offset, s.offset + d)) : (u = o === e.FLOAT ? g.mallocFloat32(d) : g.mallocUint8(d),
                    h = p(u, f, [f[2], f[2] * f[0], 1]),
                    l === e.FLOAT && o === e.UNSIGNED_BYTE ? y(h, s) : v.assign(h, s),
                    c ? e.texImage2D(e.TEXTURE_2D, n, i, f[0], f[1], 0, i, o, u.subarray(0, d)) : e.texSubImage2D(e.TEXTURE_2D, n, t, r, f[0], f[1], i, o, u.subarray(0, d)),
                    o === e.FLOAT ? g.freeFloat32(u) : g.freeUint8(u))
                }(i, t, r, n, this.format, this.type, this._mipLevels, e)
            }
        }
    }
    , {
        ndarray: 58,
        "ndarray-ops": 57,
        "typedarray-pool": 68
    }],
    39: [function(e, t, r) {
        "use strict";
        t.exports = function(e, t, r) {
            t ? t.bind() : e.bindBuffer(e.ELEMENT_ARRAY_BUFFER, null);
            var n = 0 | e.getParameter(e.MAX_VERTEX_ATTRIBS);
            if (r) {
                if (r.length > n)
                    throw new Error("gl-vao: Too many vertex attributes");
                for (var i = 0; i < r.length; ++i) {
                    var o = r[i];
                    if (o.buffer) {
                        var a = o.buffer
                          , s = o.size || 4
                          , c = o.type || e.FLOAT
                          , f = !!o.normalized
                          , l = o.stride || 0
                          , u = o.offset || 0;
                        a.bind(),
                        e.enableVertexAttribArray(i),
                        e.vertexAttribPointer(i, s, c, f, l, u)
                    } else {
                        if ("number" == typeof o)
                            e.vertexAttrib1f(i, o);
                        else if (1 === o.length)
                            e.vertexAttrib1f(i, o[0]);
                        else if (2 === o.length)
                            e.vertexAttrib2f(i, o[0], o[1]);
                        else if (3 === o.length)
                            e.vertexAttrib3f(i, o[0], o[1], o[2]);
                        else {
                            if (4 !== o.length)
                                throw new Error("gl-vao: Invalid vertex attribute");
                            e.vertexAttrib4f(i, o[0], o[1], o[2], o[3])
                        }
                        e.disableVertexAttribArray(i)
                    }
                }
                for (; i < n; ++i)
                    e.disableVertexAttribArray(i)
            } else {
                e.bindBuffer(e.ARRAY_BUFFER, null);
                for (i = 0; i < n; ++i)
                    e.disableVertexAttribArray(i)
            }
        }
    }
    , {}],
    40: [function(e, t, r) {
        "use strict";
        var n = e("./do-bind.js");
        function i(e) {
            this.gl = e,
            this._elements = null,
            this._attributes = null,
            this._elementsType = e.UNSIGNED_SHORT
        }
        i.prototype.bind = function() {
            n(this.gl, this._elements, this._attributes)
        }
        ,
        i.prototype.update = function(e, t, r) {
            this._elements = t,
            this._attributes = e,
            this._elementsType = r || this.gl.UNSIGNED_SHORT
        }
        ,
        i.prototype.dispose = function() {}
        ,
        i.prototype.unbind = function() {}
        ,
        i.prototype.draw = function(e, t, r) {
            r = r || 0;
            var n = this.gl;
            this._elements ? n.drawElements(e, t, this._elementsType, r) : n.drawArrays(e, r, t)
        }
        ,
        t.exports = function(e) {
            return new i(e)
        }
    }
    , {
        "./do-bind.js": 39
    }],
    41: [function(e, t, r) {
        "use strict";
        var o = e("./do-bind.js");
        function a(e, t, r, n, i, o) {
            this.location = e,
            this.dimension = t,
            this.a = r,
            this.b = n,
            this.c = i,
            this.d = o
        }
        function n(e, t, r) {
            this.gl = e,
            this._ext = t,
            this.handle = r,
            this._attribs = [],
            this._useElements = !1,
            this._elementsType = e.UNSIGNED_SHORT
        }
        a.prototype.bind = function(e) {
            switch (this.dimension) {
            case 1:
                e.vertexAttrib1f(this.location, this.a);
                break;
            case 2:
                e.vertexAttrib2f(this.location, this.a, this.b);
                break;
            case 3:
                e.vertexAttrib3f(this.location, this.a, this.b, this.c);
                break;
            case 4:
                e.vertexAttrib4f(this.location, this.a, this.b, this.c, this.d)
            }
        }
        ,
        n.prototype.bind = function() {
            this._ext.bindVertexArrayOES(this.handle);
            for (var e = 0; e < this._attribs.length; ++e)
                this._attribs[e].bind(this.gl)
        }
        ,
        n.prototype.unbind = function() {
            this._ext.bindVertexArrayOES(null)
        }
        ,
        n.prototype.dispose = function() {
            this._ext.deleteVertexArrayOES(this.handle)
        }
        ,
        n.prototype.update = function(e, t, r) {
            if (this.bind(),
            o(this.gl, t, e),
            this.unbind(),
            this._attribs.length = 0,
            e)
                for (var n = 0; n < e.length; ++n) {
                    var i = e[n];
                    "number" == typeof i ? this._attribs.push(new a(n,1,i)) : Array.isArray(i) && this._attribs.push(new a(n,i.length,i[0],i[1],i[2],i[3]))
                }
            this._useElements = !!t,
            this._elementsType = r || this.gl.UNSIGNED_SHORT
        }
        ,
        n.prototype.draw = function(e, t, r) {
            r = r || 0;
            var n = this.gl;
            this._useElements ? n.drawElements(e, t, this._elementsType, r) : n.drawArrays(e, r, t)
        }
        ,
        t.exports = function(e, t) {
            return new n(e,t,t.createVertexArrayOES())
        }
    }
    , {
        "./do-bind.js": 39
    }],
    42: [function(e, t, r) {
        "use strict";
        var o = e("./lib/vao-native.js")
          , a = e("./lib/vao-emulated.js");
        function s(e) {
            this.bindVertexArrayOES = e.bindVertexArray.bind(e),
            this.createVertexArrayOES = e.createVertexArray.bind(e),
            this.deleteVertexArrayOES = e.deleteVertexArray.bind(e)
        }
        t.exports = function(e, t, r, n) {
            var i = e.createVertexArray ? new s(e) : e.getExtension("OES_vertex_array_object");
            return (i = i ? o(e, i) : a(e)).update(t, r, n),
            i
        }
    }
    , {
        "./lib/vao-emulated.js": 40,
        "./lib/vao-native.js": 41
    }],
    43: [function(e, t, r) {
        var o = e("glsl-tokenizer")
          , a = e("atob-lite");
        t.exports = function(e) {
            for (var t = Array.isArray(e) ? e : o(e), r = 0; r < t.length; r++) {
                var n = t[r];
                if ("preprocessor" === n.type) {
                    var i = n.data.match(/\#define\s+SHADER_NAME(_B64)?\s+(.+)$/);
                    if (i && i[2]) {
                        n = i[1],
                        i = i[2];
                        return (n ? a(i) : i).trim()
                    }
                }
            }
        }
    }
    , {
        "atob-lite": 11,
        "glsl-tokenizer": 50
    }],
    44: [function(e, t, r) {
        t.exports = function(e) {
            var r, n, i, o = 0, a = 0, s = I, c = [], f = [], l = 1, u = 0, h = 0, d = !1, p = !1, v = "", t = T, g = E;
            "300 es" === (e = e || {}).version && (t = R,
            g = A);
            for (var y = {}, m = {}, o = 0; o < t.length; o++)
                y[t[o]] = !0;
            for (o = 0; o < g.length; o++)
                m[g[o]] = !0;
            return function(e) {
                return f = [],
                null !== e ? function(e) {
                    o = 0,
                    e.toString && (e = e.toString());
                    var t;
                    v += e.replace(/\r\n/g, "\n"),
                    i = v.length;
                    for (; r = v[o],
                    o < i; ) {
                        switch (t = o,
                        s) {
                        case P:
                            "/" !== r || "*" !== n ? (c.push(r),
                            n = r) : (c.push(r),
                            _(c.join("")),
                            s = I),
                            o += 1;
                            break;
                        case S:
                        case N:
                            o = x();
                            break;
                        case M:
                            o = function() {
                                if ("." === n && /\d/.test(r))
                                    return s = C,
                                    o;
                                if ("/" === n && "*" === r)
                                    return s = P,
                                    o;
                                if ("/" === n && "/" === r)
                                    return s = S,
                                    o;
                                if ("." === r && c.length) {
                                    for (; b(c); )
                                        ;
                                    return s = C,
                                    o
                                }
                                if (";" === r || ")" === r || "(" === r) {
                                    if (c.length)
                                        for (; b(c); )
                                            ;
                                    return _(r),
                                    s = I,
                                    o + 1
                                }
                                var e = 2 === c.length && "=" !== r;
                                if (/[\w_\d\s]/.test(r) || e) {
                                    for (; b(c); )
                                        ;
                                    return s = I,
                                    o
                                }
                                return c.push(r),
                                n = r,
                                o + 1
                            }();
                            break;
                        case L:
                            o = function() {
                                if ("." === r)
                                    return c.push(r),
                                    s = C,
                                    n = r,
                                    o + 1;
                                if (/[eE]/.test(r))
                                    return c.push(r),
                                    s = C,
                                    n = r,
                                    o + 1;
                                if ("x" === r && 1 === c.length && "0" === c[0])
                                    return s = j,
                                    c.push(r),
                                    n = r,
                                    o + 1;
                                if (/[^\d]/.test(r))
                                    return _(c.join("")),
                                    s = I,
                                    o;
                                return c.push(r),
                                n = r,
                                o + 1
                            }();
                            break;
                        case j:
                            o = function() {
                                if (/[^a-fA-F0-9]/.test(r))
                                    return _(c.join("")),
                                    s = I,
                                    o;
                                return c.push(r),
                                n = r,
                                o + 1
                            }();
                            break;
                        case C:
                            o = function() {
                                "f" === r && (c.push(r),
                                n = r,
                                o += 1);
                                if (/[eE]/.test(r))
                                    return c.push(r),
                                    n = r,
                                    o + 1;
                                if (("-" === r || "+" === r) && /[eE]/.test(n))
                                    return c.push(r),
                                    n = r,
                                    o + 1;
                                if (/[^\d]/.test(r))
                                    return _(c.join("")),
                                    s = I,
                                    o;
                                return c.push(r),
                                n = r,
                                o + 1
                            }();
                            break;
                        case U:
                            o = function() {
                                if (/[^\d\w_]/.test(r)) {
                                    var e = c.join("");
                                    return s = m[e] ? D : y[e] ? F : B,
                                    _(c.join("")),
                                    s = I,
                                    o
                                }
                                return c.push(r),
                                n = r,
                                o + 1
                            }();
                            break;
                        case z:
                            o = function() {
                                if (/[^\s]/g.test(r))
                                    return _(c.join("")),
                                    s = I,
                                    o;
                                return c.push(r),
                                n = r,
                                o + 1
                            }();
                            break;
                        case I:
                            o = function() {
                                if (c = c.length ? [] : c,
                                "/" === n && "*" === r)
                                    return h = a + o - 1,
                                    s = P,
                                    n = r,
                                    o + 1;
                                if ("/" === n && "/" === r)
                                    return h = a + o - 1,
                                    s = S,
                                    n = r,
                                    o + 1;
                                if ("#" === r)
                                    return s = N,
                                    h = a + o,
                                    o;
                                if (/\s/.test(r))
                                    return s = z,
                                    h = a + o,
                                    o;
                                return d = /\d/.test(r),
                                p = /[^\w_]/.test(r),
                                h = a + o,
                                s = d ? L : p ? M : U,
                                o
                            }()
                        }
                        t !== o && ("\n" === v[t] ? (u = 0,
                        ++l) : ++u)
                    }
                    return a += o,
                    v = v.slice(o),
                    f
                }(e) : function() {
                    c.length && _(c.join(""));
                    return s = O,
                    _("(eof)"),
                    f
                }()
            }
            ;
            function _(e) {
                e.length && f.push({
                    type: k[s],
                    data: e,
                    position: h,
                    line: l,
                    column: u
                })
            }
            function x() {
                return "\r" !== r && "\n" !== r || "\\" === n ? (c.push(r),
                n = r,
                o + 1) : (_(c.join("")),
                s = I,
                o)
            }
            function b(e) {
                var t, r, n = 0;
                do {
                    if (t = w.indexOf(e.slice(0, e.length + n).join("")),
                    r = w[t],
                    -1 === t) {
                        if (0 < n-- + e.length)
                            continue;
                        r = e.slice(0, 1).join("")
                    }
                    return _(r),
                    h += r.length,
                    (c = c.slice(r.length)).length
                } while (1)
            }
        }
        ;
        var E = e("./lib/literals")
          , w = e("./lib/operators")
          , T = e("./lib/builtins")
          , A = e("./lib/literals-300es")
          , R = e("./lib/builtins-300es")
          , I = 999
          , U = 9999
          , P = 0
          , S = 1
          , N = 2
          , M = 3
          , L = 4
          , C = 5
          , B = 6
          , F = 7
          , D = 8
          , z = 9
          , O = 10
          , j = 11
          , k = ["block-comment", "line-comment", "preprocessor", "operator", "integer", "float", "ident", "builtin", "keyword", "whitespace", "eof", "integer"]
    }
    , {
        "./lib/builtins": 46,
        "./lib/builtins-300es": 45,
        "./lib/literals": 48,
        "./lib/literals-300es": 47,
        "./lib/operators": 49
    }],
    45: [function(e, t, r) {
        var n = (n = e("./builtins")).slice().filter(function(e) {
            return !/^(gl\_|texture)/.test(e)
        });
        t.exports = n.concat(["gl_VertexID", "gl_InstanceID", "gl_Position", "gl_PointSize", "gl_FragCoord", "gl_FrontFacing", "gl_FragDepth", "gl_PointCoord", "gl_MaxVertexAttribs", "gl_MaxVertexUniformVectors", "gl_MaxVertexOutputVectors", "gl_MaxFragmentInputVectors", "gl_MaxVertexTextureImageUnits", "gl_MaxCombinedTextureImageUnits", "gl_MaxTextureImageUnits", "gl_MaxFragmentUniformVectors", "gl_MaxDrawBuffers", "gl_MinProgramTexelOffset", "gl_MaxProgramTexelOffset", "gl_DepthRangeParameters", "gl_DepthRange", "trunc", "round", "roundEven", "isnan", "isinf", "floatBitsToInt", "floatBitsToUint", "intBitsToFloat", "uintBitsToFloat", "packSnorm2x16", "unpackSnorm2x16", "packUnorm2x16", "unpackUnorm2x16", "packHalf2x16", "unpackHalf2x16", "outerProduct", "transpose", "determinant", "inverse", "texture", "textureSize", "textureProj", "textureLod", "textureOffset", "texelFetch", "texelFetchOffset", "textureProjOffset", "textureLodOffset", "textureProjLod", "textureProjLodOffset", "textureGrad", "textureGradOffset", "textureProjGrad", "textureProjGradOffset"])
    }
    , {
        "./builtins": 46
    }],
    46: [function(e, t, r) {
        t.exports = ["abs", "acos", "all", "any", "asin", "atan", "ceil", "clamp", "cos", "cross", "dFdx", "dFdy", "degrees", "distance", "dot", "equal", "exp", "exp2", "faceforward", "floor", "fract", "gl_BackColor", "gl_BackLightModelProduct", "gl_BackLightProduct", "gl_BackMaterial", "gl_BackSecondaryColor", "gl_ClipPlane", "gl_ClipVertex", "gl_Color", "gl_DepthRange", "gl_DepthRangeParameters", "gl_EyePlaneQ", "gl_EyePlaneR", "gl_EyePlaneS", "gl_EyePlaneT", "gl_Fog", "gl_FogCoord", "gl_FogFragCoord", "gl_FogParameters", "gl_FragColor", "gl_FragCoord", "gl_FragData", "gl_FragDepth", "gl_FragDepthEXT", "gl_FrontColor", "gl_FrontFacing", "gl_FrontLightModelProduct", "gl_FrontLightProduct", "gl_FrontMaterial", "gl_FrontSecondaryColor", "gl_LightModel", "gl_LightModelParameters", "gl_LightModelProducts", "gl_LightProducts", "gl_LightSource", "gl_LightSourceParameters", "gl_MaterialParameters", "gl_MaxClipPlanes", "gl_MaxCombinedTextureImageUnits", "gl_MaxDrawBuffers", "gl_MaxFragmentUniformComponents", "gl_MaxLights", "gl_MaxTextureCoords", "gl_MaxTextureImageUnits", "gl_MaxTextureUnits", "gl_MaxVaryingFloats", "gl_MaxVertexAttribs", "gl_MaxVertexTextureImageUnits", "gl_MaxVertexUniformComponents", "gl_ModelViewMatrix", "gl_ModelViewMatrixInverse", "gl_ModelViewMatrixInverseTranspose", "gl_ModelViewMatrixTranspose", "gl_ModelViewProjectionMatrix", "gl_ModelViewProjectionMatrixInverse", "gl_ModelViewProjectionMatrixInverseTranspose", "gl_ModelViewProjectionMatrixTranspose", "gl_MultiTexCoord0", "gl_MultiTexCoord1", "gl_MultiTexCoord2", "gl_MultiTexCoord3", "gl_MultiTexCoord4", "gl_MultiTexCoord5", "gl_MultiTexCoord6", "gl_MultiTexCoord7", "gl_Normal", "gl_NormalMatrix", "gl_NormalScale", "gl_ObjectPlaneQ", "gl_ObjectPlaneR", "gl_ObjectPlaneS", "gl_ObjectPlaneT", "gl_Point", "gl_PointCoord", "gl_PointParameters", "gl_PointSize", "gl_Position", "gl_ProjectionMatrix", "gl_ProjectionMatrixInverse", "gl_ProjectionMatrixInverseTranspose", "gl_ProjectionMatrixTranspose", "gl_SecondaryColor", "gl_TexCoord", "gl_TextureEnvColor", "gl_TextureMatrix", "gl_TextureMatrixInverse", "gl_TextureMatrixInverseTranspose", "gl_TextureMatrixTranspose", "gl_Vertex", "greaterThan", "greaterThanEqual", "inversesqrt", "length", "lessThan", "lessThanEqual", "log", "log2", "matrixCompMult", "max", "min", "mix", "mod", "normalize", "not", "notEqual", "pow", "radians", "reflect", "refract", "sign", "sin", "smoothstep", "sqrt", "step", "tan", "texture2D", "texture2DLod", "texture2DProj", "texture2DProjLod", "textureCube", "textureCubeLod", "texture2DLodEXT", "texture2DProjLodEXT", "textureCubeLodEXT", "texture2DGradEXT", "texture2DProjGradEXT", "textureCubeGradEXT"]
    }
    , {}],
    47: [function(e, t, r) {
        var n = e("./literals");
        t.exports = n.slice().concat(["layout", "centroid", "smooth", "case", "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4", "uvec2", "uvec3", "uvec4", "samplerCubeShadow", "sampler2DArray", "sampler2DArrayShadow", "isampler2D", "isampler3D", "isamplerCube", "isampler2DArray", "usampler2D", "usampler3D", "usamplerCube", "usampler2DArray", "coherent", "restrict", "readonly", "writeonly", "resource", "atomic_uint", "noperspective", "patch", "sample", "subroutine", "common", "partition", "active", "filter", "image1D", "image2D", "image3D", "imageCube", "iimage1D", "iimage2D", "iimage3D", "iimageCube", "uimage1D", "uimage2D", "uimage3D", "uimageCube", "image1DArray", "image2DArray", "iimage1DArray", "iimage2DArray", "uimage1DArray", "uimage2DArray", "image1DShadow", "image2DShadow", "image1DArrayShadow", "image2DArrayShadow", "imageBuffer", "iimageBuffer", "uimageBuffer", "sampler1DArray", "sampler1DArrayShadow", "isampler1D", "isampler1DArray", "usampler1D", "usampler1DArray", "isampler2DRect", "usampler2DRect", "samplerBuffer", "isamplerBuffer", "usamplerBuffer", "sampler2DMS", "isampler2DMS", "usampler2DMS", "sampler2DMSArray", "isampler2DMSArray", "usampler2DMSArray"])
    }
    , {
        "./literals": 48
    }],
    48: [function(e, t, r) {
        t.exports = ["precision", "highp", "mediump", "lowp", "attribute", "const", "uniform", "varying", "break", "continue", "do", "for", "while", "if", "else", "in", "out", "inout", "float", "int", "uint", "void", "bool", "true", "false", "discard", "return", "mat2", "mat3", "mat4", "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "bvec2", "bvec3", "bvec4", "sampler1D", "sampler2D", "sampler3D", "samplerCube", "sampler1DShadow", "sampler2DShadow", "struct", "asm", "class", "union", "enum", "typedef", "template", "this", "packed", "goto", "switch", "default", "inline", "noinline", "volatile", "public", "static", "extern", "external", "interface", "long", "short", "double", "half", "fixed", "unsigned", "input", "output", "hvec2", "hvec3", "hvec4", "dvec2", "dvec3", "dvec4", "fvec2", "fvec3", "fvec4", "sampler2DRect", "sampler3DRect", "sampler2DRectShadow", "sizeof", "cast", "namespace", "using"]
    }
    , {}],
    49: [function(e, t, r) {
        t.exports = ["<<=", ">>=", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "^^", "^=", "|=", "(", ")", "[", "]", ".", "!", "~", "*", "/", "%", "+", "-", "<", ">", "&", "^", "|", "?", ":", "=", ",", ";", "{", "}"]
    }
    , {}],
    50: [function(e, t, r) {
        var i = e("./index");
        t.exports = function(e, t) {
            var r = i(t)
              , n = [];
            return n = (n = n.concat(r(e))).concat(r(null))
        }
    }
    , {
        "./index": 44
    }],
    51: [function(e, t, r) {
        t.exports = function(e) {
            "string" == typeof e && (e = [e]);
            for (var t = [].slice.call(arguments, 1), r = [], n = 0; n < e.length - 1; n++)
                r.push(e[n], t[n] || "");
            return r.push(e[n]),
            r.join("")
        }
    }
    , {}],
    52: [function(e, t, r) {
        r.read = function(e, t, r, n, i) {
            var o, a, s = 8 * i - n - 1, c = (1 << s) - 1, f = c >> 1, l = -7, u = r ? i - 1 : 0, h = r ? -1 : 1, d = e[t + u];
            for (u += h,
            o = d & (1 << -l) - 1,
            d >>= -l,
            l += s; 0 < l; o = 256 * o + e[t + u],
            u += h,
            l -= 8)
                ;
            for (a = o & (1 << -l) - 1,
            o >>= -l,
            l += n; 0 < l; a = 256 * a + e[t + u],
            u += h,
            l -= 8)
                ;
            if (0 === o)
                o = 1 - f;
            else {
                if (o === c)
                    return a ? NaN : 1 / 0 * (d ? -1 : 1);
                a += Math.pow(2, n),
                o -= f
            }
            return (d ? -1 : 1) * a * Math.pow(2, o - n)
        }
        ,
        r.write = function(e, t, r, n, i, o) {
            var a, s, c, f = 8 * o - i - 1, l = (1 << f) - 1, u = l >> 1, h = 23 === i ? Math.pow(2, -24) - Math.pow(2, -77) : 0, d = n ? 0 : o - 1, p = n ? 1 : -1, v = t < 0 || 0 === t && 1 / t < 0 ? 1 : 0;
            for (t = Math.abs(t),
            isNaN(t) || t === 1 / 0 ? (s = isNaN(t) ? 1 : 0,
            a = l) : (a = Math.floor(Math.log(t) / Math.LN2),
            t * (c = Math.pow(2, -a)) < 1 && (a--,
            c *= 2),
            2 <= (t += 1 <= a + u ? h / c : h * Math.pow(2, 1 - u)) * c && (a++,
            c /= 2),
            l <= a + u ? (s = 0,
            a = l) : 1 <= a + u ? (s = (t * c - 1) * Math.pow(2, i),
            a += u) : (s = t * Math.pow(2, u - 1) * Math.pow(2, i),
            a = 0)); 8 <= i; e[r + d] = 255 & s,
            d += p,
            s /= 256,
            i -= 8)
                ;
            for (a = a << i | s,
            f += i; 0 < f; e[r + d] = 255 & a,
            d += p,
            a /= 256,
            f -= 8)
                ;
            e[r + d - p] |= 128 * v
        }
    }
    , {}],
    53: [function(e, t, r) {
        "function" == typeof Object.create ? t.exports = function(e, t) {
            t && (e.super_ = t,
            e.prototype = Object.create(t.prototype, {
                constructor: {
                    value: e,
                    enumerable: !1,
                    writable: !0,
                    configurable: !0
                }
            }))
        }
        : t.exports = function(e, t) {
            var r;
            t && (e.super_ = t,
            (r = function() {}
            ).prototype = t.prototype,
            e.prototype = new r,
            e.prototype.constructor = e)
        }
    }
    , {}],
    54: [function(e, t, r) {
        "use strict";
        t.exports = function(e) {
            for (var t = new Array(e), r = 0; r < e; ++r)
                t[r] = r;
            return t
        }
    }
    , {}],
    55: [function(e, t, r) {
        function n(e) {
            return !!e.constructor && "function" == typeof e.constructor.isBuffer && e.constructor.isBuffer(e)
        }
        t.exports = function(e) {
            return null != e && (n(e) || "function" == typeof (t = e).readFloatLE && "function" == typeof t.slice && n(t.slice(0, 0)) || !!e._isBuffer);
            var t
        }
    }
    , {}],
    56: [function(e, t, r) {
        "use strict";
        var n = e("cwise/lib/wrapper")({
            args: ["index", "array", "scalar"],
            pre: {
                body: "{}",
                args: [],
                thisVars: [],
                localVars: []
            },
            body: {
                body: "{_inline_1_arg1_=_inline_1_arg2_.apply(void 0,_inline_1_arg0_)}",
                args: [{
                    name: "_inline_1_arg0_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }, {
                    name: "_inline_1_arg1_",
                    lvalue: !0,
                    rvalue: !1,
                    count: 1
                }, {
                    name: "_inline_1_arg2_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }],
                thisVars: [],
                localVars: []
            },
            post: {
                body: "{}",
                args: [],
                thisVars: [],
                localVars: []
            },
            debug: !1,
            funcName: "cwise",
            blockSize: 64
        });
        t.exports = function(e, t) {
            return n(e, t),
            e
        }
    }
    , {
        "cwise/lib/wrapper": 19
    }],
    57: [function(e, t, r) {
        "use strict";
        var i = e("cwise-compiler")
          , n = {
            body: "",
            args: [],
            thisVars: [],
            localVars: []
        };
        function o(e) {
            if (!e)
                return n;
            for (var t = 0; t < e.args.length; ++t) {
                var r = e.args[t];
                e.args[t] = 0 === t ? {
                    name: r,
                    lvalue: !0,
                    rvalue: !!e.rvalue,
                    count: e.count || 1
                } : {
                    name: r,
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }
            }
            return e.thisVars || (e.thisVars = []),
            e.localVars || (e.localVars = []),
            e
        }
        function a(e) {
            for (var t, r = [], n = 0; n < e.args.length; ++n)
                r.push("a" + n);
            return new Function("P",["return function ", e.funcName, "_ndarrayops(", r.join(","), ") {P(", r.join(","), ");return a0}"].join(""))(i({
                args: (t = e).args,
                pre: o(t.pre),
                body: o(t.body),
                post: o(t.proc),
                funcName: t.funcName
            }))
        }
        var s = {
            add: "+",
            sub: "-",
            mul: "*",
            div: "/",
            mod: "%",
            band: "&",
            bor: "|",
            bxor: "^",
            lshift: "<<",
            rshift: ">>",
            rrshift: ">>>"
        };
        !function() {
            for (var e in s) {
                var t = s[e];
                r[e] = a({
                    args: ["array", "array", "array"],
                    body: {
                        args: ["a", "b", "c"],
                        body: "a=b" + t + "c"
                    },
                    funcName: e
                }),
                r[e + "eq"] = a({
                    args: ["array", "array"],
                    body: {
                        args: ["a", "b"],
                        body: "a" + t + "=b"
                    },
                    rvalue: !0,
                    funcName: e + "eq"
                }),
                r[e + "s"] = a({
                    args: ["array", "array", "scalar"],
                    body: {
                        args: ["a", "b", "s"],
                        body: "a=b" + t + "s"
                    },
                    funcName: e + "s"
                }),
                r[e + "seq"] = a({
                    args: ["array", "scalar"],
                    body: {
                        args: ["a", "s"],
                        body: "a" + t + "=s"
                    },
                    rvalue: !0,
                    funcName: e + "seq"
                })
            }
        }();
        var c = {
            not: "!",
            bnot: "~",
            neg: "-",
            recip: "1.0/"
        };
        !function() {
            for (var e in c) {
                var t = c[e];
                r[e] = a({
                    args: ["array", "array"],
                    body: {
                        args: ["a", "b"],
                        body: "a=" + t + "b"
                    },
                    funcName: e
                }),
                r[e + "eq"] = a({
                    args: ["array"],
                    body: {
                        args: ["a"],
                        body: "a=" + t + "a"
                    },
                    rvalue: !0,
                    count: 2,
                    funcName: e + "eq"
                })
            }
        }();
        var f = {
            and: "&&",
            or: "||",
            eq: "===",
            neq: "!==",
            lt: "<",
            gt: ">",
            leq: "<=",
            geq: ">="
        };
        !function() {
            for (var e in f) {
                var t = f[e];
                r[e] = a({
                    args: ["array", "array", "array"],
                    body: {
                        args: ["a", "b", "c"],
                        body: "a=b" + t + "c"
                    },
                    funcName: e
                }),
                r[e + "s"] = a({
                    args: ["array", "array", "scalar"],
                    body: {
                        args: ["a", "b", "s"],
                        body: "a=b" + t + "s"
                    },
                    funcName: e + "s"
                }),
                r[e + "eq"] = a({
                    args: ["array", "array"],
                    body: {
                        args: ["a", "b"],
                        body: "a=a" + t + "b"
                    },
                    rvalue: !0,
                    count: 2,
                    funcName: e + "eq"
                }),
                r[e + "seq"] = a({
                    args: ["array", "scalar"],
                    body: {
                        args: ["a", "s"],
                        body: "a=a" + t + "s"
                    },
                    rvalue: !0,
                    count: 2,
                    funcName: e + "seq"
                })
            }
        }();
        var l = ["abs", "acos", "asin", "atan", "ceil", "cos", "exp", "floor", "log", "round", "sin", "sqrt", "tan"];
        !function() {
            for (var e = 0; e < l.length; ++e) {
                var t = l[e];
                r[t] = a({
                    args: ["array", "array"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a", "b"],
                        body: "a=this_f(b)",
                        thisVars: ["this_f"]
                    },
                    funcName: t
                }),
                r[t + "eq"] = a({
                    args: ["array"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a"],
                        body: "a=this_f(a)",
                        thisVars: ["this_f"]
                    },
                    rvalue: !0,
                    count: 2,
                    funcName: t + "eq"
                })
            }
        }();
        var u = ["max", "min", "atan2", "pow"];
        !function() {
            for (var e = 0; e < u.length; ++e) {
                var t = u[e];
                r[t] = a({
                    args: ["array", "array", "array"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a", "b", "c"],
                        body: "a=this_f(b,c)",
                        thisVars: ["this_f"]
                    },
                    funcName: t
                }),
                r[t + "s"] = a({
                    args: ["array", "array", "scalar"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a", "b", "c"],
                        body: "a=this_f(b,c)",
                        thisVars: ["this_f"]
                    },
                    funcName: t + "s"
                }),
                r[t + "eq"] = a({
                    args: ["array", "array"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a", "b"],
                        body: "a=this_f(a,b)",
                        thisVars: ["this_f"]
                    },
                    rvalue: !0,
                    count: 2,
                    funcName: t + "eq"
                }),
                r[t + "seq"] = a({
                    args: ["array", "scalar"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a", "b"],
                        body: "a=this_f(a,b)",
                        thisVars: ["this_f"]
                    },
                    rvalue: !0,
                    count: 2,
                    funcName: t + "seq"
                })
            }
        }();
        var h = ["atan2", "pow"];
        !function() {
            for (var e = 0; e < h.length; ++e) {
                var t = h[e];
                r[t + "op"] = a({
                    args: ["array", "array", "array"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a", "b", "c"],
                        body: "a=this_f(c,b)",
                        thisVars: ["this_f"]
                    },
                    funcName: t + "op"
                }),
                r[t + "ops"] = a({
                    args: ["array", "array", "scalar"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a", "b", "c"],
                        body: "a=this_f(c,b)",
                        thisVars: ["this_f"]
                    },
                    funcName: t + "ops"
                }),
                r[t + "opeq"] = a({
                    args: ["array", "array"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a", "b"],
                        body: "a=this_f(b,a)",
                        thisVars: ["this_f"]
                    },
                    rvalue: !0,
                    count: 2,
                    funcName: t + "opeq"
                }),
                r[t + "opseq"] = a({
                    args: ["array", "scalar"],
                    pre: {
                        args: [],
                        body: "this_f=Math." + t,
                        thisVars: ["this_f"]
                    },
                    body: {
                        args: ["a", "b"],
                        body: "a=this_f(b,a)",
                        thisVars: ["this_f"]
                    },
                    rvalue: !0,
                    count: 2,
                    funcName: t + "opseq"
                })
            }
        }(),
        r.any = i({
            args: ["array"],
            pre: n,
            body: {
                args: [{
                    name: "a",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }],
                body: "if(a){return true}",
                localVars: [],
                thisVars: []
            },
            post: {
                args: [],
                localVars: [],
                thisVars: [],
                body: "return false"
            },
            funcName: "any"
        }),
        r.all = i({
            args: ["array"],
            pre: n,
            body: {
                args: [{
                    name: "x",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }],
                body: "if(!x){return false}",
                localVars: [],
                thisVars: []
            },
            post: {
                args: [],
                localVars: [],
                thisVars: [],
                body: "return true"
            },
            funcName: "all"
        }),
        r.sum = i({
            args: ["array"],
            pre: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "this_s=0"
            },
            body: {
                args: [{
                    name: "a",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }],
                body: "this_s+=a",
                localVars: [],
                thisVars: ["this_s"]
            },
            post: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "return this_s"
            },
            funcName: "sum"
        }),
        r.prod = i({
            args: ["array"],
            pre: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "this_s=1"
            },
            body: {
                args: [{
                    name: "a",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }],
                body: "this_s*=a",
                localVars: [],
                thisVars: ["this_s"]
            },
            post: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "return this_s"
            },
            funcName: "prod"
        }),
        r.norm2squared = i({
            args: ["array"],
            pre: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "this_s=0"
            },
            body: {
                args: [{
                    name: "a",
                    lvalue: !1,
                    rvalue: !0,
                    count: 2
                }],
                body: "this_s+=a*a",
                localVars: [],
                thisVars: ["this_s"]
            },
            post: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "return this_s"
            },
            funcName: "norm2squared"
        }),
        r.norm2 = i({
            args: ["array"],
            pre: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "this_s=0"
            },
            body: {
                args: [{
                    name: "a",
                    lvalue: !1,
                    rvalue: !0,
                    count: 2
                }],
                body: "this_s+=a*a",
                localVars: [],
                thisVars: ["this_s"]
            },
            post: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "return Math.sqrt(this_s)"
            },
            funcName: "norm2"
        }),
        r.norminf = i({
            args: ["array"],
            pre: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "this_s=0"
            },
            body: {
                args: [{
                    name: "a",
                    lvalue: !1,
                    rvalue: !0,
                    count: 4
                }],
                body: "if(-a>this_s){this_s=-a}else if(a>this_s){this_s=a}",
                localVars: [],
                thisVars: ["this_s"]
            },
            post: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "return this_s"
            },
            funcName: "norminf"
        }),
        r.norm1 = i({
            args: ["array"],
            pre: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "this_s=0"
            },
            body: {
                args: [{
                    name: "a",
                    lvalue: !1,
                    rvalue: !0,
                    count: 3
                }],
                body: "this_s+=a<0?-a:a",
                localVars: [],
                thisVars: ["this_s"]
            },
            post: {
                args: [],
                localVars: [],
                thisVars: ["this_s"],
                body: "return this_s"
            },
            funcName: "norm1"
        }),
        r.sup = i({
            args: ["array"],
            pre: {
                body: "this_h=-Infinity",
                args: [],
                thisVars: ["this_h"],
                localVars: []
            },
            body: {
                body: "if(_inline_1_arg0_>this_h)this_h=_inline_1_arg0_",
                args: [{
                    name: "_inline_1_arg0_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 2
                }],
                thisVars: ["this_h"],
                localVars: []
            },
            post: {
                body: "return this_h",
                args: [],
                thisVars: ["this_h"],
                localVars: []
            }
        }),
        r.inf = i({
            args: ["array"],
            pre: {
                body: "this_h=Infinity",
                args: [],
                thisVars: ["this_h"],
                localVars: []
            },
            body: {
                body: "if(_inline_1_arg0_<this_h)this_h=_inline_1_arg0_",
                args: [{
                    name: "_inline_1_arg0_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 2
                }],
                thisVars: ["this_h"],
                localVars: []
            },
            post: {
                body: "return this_h",
                args: [],
                thisVars: ["this_h"],
                localVars: []
            }
        }),
        r.argmin = i({
            args: ["index", "array", "shape"],
            pre: {
                body: "{this_v=Infinity;this_i=_inline_0_arg2_.slice(0)}",
                args: [{
                    name: "_inline_0_arg0_",
                    lvalue: !1,
                    rvalue: !1,
                    count: 0
                }, {
                    name: "_inline_0_arg1_",
                    lvalue: !1,
                    rvalue: !1,
                    count: 0
                }, {
                    name: "_inline_0_arg2_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }],
                thisVars: ["this_i", "this_v"],
                localVars: []
            },
            body: {
                body: "{if(_inline_1_arg1_<this_v){this_v=_inline_1_arg1_;for(var _inline_1_k=0;_inline_1_k<_inline_1_arg0_.length;++_inline_1_k){this_i[_inline_1_k]=_inline_1_arg0_[_inline_1_k]}}}",
                args: [{
                    name: "_inline_1_arg0_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 2
                }, {
                    name: "_inline_1_arg1_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 2
                }],
                thisVars: ["this_i", "this_v"],
                localVars: ["_inline_1_k"]
            },
            post: {
                body: "{return this_i}",
                args: [],
                thisVars: ["this_i"],
                localVars: []
            }
        }),
        r.argmax = i({
            args: ["index", "array", "shape"],
            pre: {
                body: "{this_v=-Infinity;this_i=_inline_0_arg2_.slice(0)}",
                args: [{
                    name: "_inline_0_arg0_",
                    lvalue: !1,
                    rvalue: !1,
                    count: 0
                }, {
                    name: "_inline_0_arg1_",
                    lvalue: !1,
                    rvalue: !1,
                    count: 0
                }, {
                    name: "_inline_0_arg2_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }],
                thisVars: ["this_i", "this_v"],
                localVars: []
            },
            body: {
                body: "{if(_inline_1_arg1_>this_v){this_v=_inline_1_arg1_;for(var _inline_1_k=0;_inline_1_k<_inline_1_arg0_.length;++_inline_1_k){this_i[_inline_1_k]=_inline_1_arg0_[_inline_1_k]}}}",
                args: [{
                    name: "_inline_1_arg0_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 2
                }, {
                    name: "_inline_1_arg1_",
                    lvalue: !1,
                    rvalue: !0,
                    count: 2
                }],
                thisVars: ["this_i", "this_v"],
                localVars: ["_inline_1_k"]
            },
            post: {
                body: "{return this_i}",
                args: [],
                thisVars: ["this_i"],
                localVars: []
            }
        }),
        r.random = a({
            args: ["array"],
            pre: {
                args: [],
                body: "this_f=Math.random",
                thisVars: ["this_f"]
            },
            body: {
                args: ["a"],
                body: "a=this_f()",
                thisVars: ["this_f"]
            },
            funcName: "random"
        }),
        r.assign = a({
            args: ["array", "array"],
            body: {
                args: ["a", "b"],
                body: "a=b"
            },
            funcName: "assign"
        }),
        r.assigns = a({
            args: ["array", "scalar"],
            body: {
                args: ["a", "b"],
                body: "a=b"
            },
            funcName: "assigns"
        }),
        r.equals = i({
            args: ["array", "array"],
            pre: n,
            body: {
                args: [{
                    name: "x",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }, {
                    name: "y",
                    lvalue: !1,
                    rvalue: !0,
                    count: 1
                }],
                body: "if(x!==y){return false}",
                localVars: [],
                thisVars: []
            },
            post: {
                args: [],
                localVars: [],
                thisVars: [],
                body: "return true"
            },
            funcName: "equals"
        })
    }
    , {
        "cwise-compiler": 16
    }],
    58: [function(e, t, r) {
        var d = e("iota-array")
          , f = e("is-buffer")
          , l = "undefined" != typeof Float64Array;
        function i(e, t) {
            return e[0] - t[0]
        }
        function p() {
            for (var e = this.stride, t = new Array(e.length), r = 0; r < t.length; ++r)
                t[r] = [Math.abs(e[r]), r];
            t.sort(i);
            var n = new Array(t.length);
            for (r = 0; r < n.length; ++r)
                n[r] = t[r][1];
            return n
        }
        function u(e, t) {
            var r = ["View", t, "d", e].join("");
            t < 0 && (r = "View_Nil" + e);
            var n = "generic" === e;
            if (-1 === t) {
                var i = "function " + r + "(a){this.data=a;};var proto=" + r + ".prototype;proto.dtype='" + e + "';proto.index=function(){return -1};proto.size=0;proto.dimension=-1;proto.shape=proto.stride=proto.order=[];proto.lo=proto.hi=proto.transpose=proto.step=function(){return new " + r + "(this.data);};proto.get=proto.set=function(){};proto.pick=function(){return null};return function construct_" + r + "(a){return new " + r + "(a);}";
                return new Function(i)()
            }
            if (0 === t) {
                i = "function " + r + "(a,d) {this.data = a;this.offset = d};var proto=" + r + ".prototype;proto.dtype='" + e + "';proto.index=function(){return this.offset};proto.dimension=0;proto.size=1;proto.shape=proto.stride=proto.order=[];proto.lo=proto.hi=proto.transpose=proto.step=function " + r + "_copy() {return new " + r + "(this.data,this.offset)};proto.pick=function " + r + "_pick(){return TrivialArray(this.data);};proto.valueOf=proto.get=function " + r + "_get(){return " + (n ? "this.data.get(this.offset)" : "this.data[this.offset]") + "};proto.set=function " + r + "_set(v){return " + (n ? "this.data.set(this.offset,v)" : "this.data[this.offset]=v") + "};return function construct_" + r + "(a,b,c,d){return new " + r + "(a,d)}";
                return new Function("TrivialArray",i)(v[e][0])
            }
            var i = ["'use strict'"]
              , o = d(t)
              , a = o.map(function(e) {
                return "i" + e
            })
              , s = "this.offset+" + o.map(function(e) {
                return "this.stride[" + e + "]*i" + e
            }).join("+")
              , c = o.map(function(e) {
                return "b" + e
            }).join(",")
              , f = o.map(function(e) {
                return "c" + e
            }).join(",");
            i.push("function " + r + "(a," + c + "," + f + ",d){this.data=a", "this.shape=[" + c + "]", "this.stride=[" + f + "]", "this.offset=d|0}", "var proto=" + r + ".prototype", "proto.dtype='" + e + "'", "proto.dimension=" + t),
            i.push("Object.defineProperty(proto,'size',{get:function " + r + "_size(){return " + o.map(function(e) {
                return "this.shape[" + e + "]"
            }).join("*"), "}})"),
            1 === t ? i.push("proto.order=[0]") : (i.push("Object.defineProperty(proto,'order',{get:"),
            t < 4 ? (i.push("function " + r + "_order(){"),
            2 === t ? i.push("return (Math.abs(this.stride[0])>Math.abs(this.stride[1]))?[1,0]:[0,1]}})") : 3 === t && i.push("var s0=Math.abs(this.stride[0]),s1=Math.abs(this.stride[1]),s2=Math.abs(this.stride[2]);if(s0>s1){if(s1>s2){return [2,1,0];}else if(s0>s2){return [1,2,0];}else{return [1,0,2];}}else if(s0>s2){return [2,0,1];}else if(s2>s1){return [0,1,2];}else{return [0,2,1];}}})")) : i.push("ORDER})")),
            i.push("proto.set=function " + r + "_set(" + a.join(",") + ",v){"),
            n ? i.push("return this.data.set(" + s + ",v)}") : i.push("return this.data[" + s + "]=v}"),
            i.push("proto.get=function " + r + "_get(" + a.join(",") + "){"),
            n ? i.push("return this.data.get(" + s + ")}") : i.push("return this.data[" + s + "]}"),
            i.push("proto.index=function " + r + "_index(", a.join(), "){return " + s + "}"),
            i.push("proto.hi=function " + r + "_hi(" + a.join(",") + "){return new " + r + "(this.data," + o.map(function(e) {
                return ["(typeof i", e, "!=='number'||i", e, "<0)?this.shape[", e, "]:i", e, "|0"].join("")
            }).join(",") + "," + o.map(function(e) {
                return "this.stride[" + e + "]"
            }).join(",") + ",this.offset)}");
            n = o.map(function(e) {
                return "a" + e + "=this.shape[" + e + "]"
            }),
            s = o.map(function(e) {
                return "c" + e + "=this.stride[" + e + "]"
            });
            i.push("proto.lo=function " + r + "_lo(" + a.join(",") + "){var b=this.offset,d=0," + n.join(",") + "," + s.join(","));
            for (var l = 0; l < t; ++l)
                i.push("if(typeof i" + l + "==='number'&&i" + l + ">=0){d=i" + l + "|0;b+=c" + l + "*d;a" + l + "-=d}");
            i.push("return new " + r + "(this.data," + o.map(function(e) {
                return "a" + e
            }).join(",") + "," + o.map(function(e) {
                return "c" + e
            }).join(",") + ",b)}"),
            i.push("proto.step=function " + r + "_step(" + a.join(",") + "){var " + o.map(function(e) {
                return "a" + e + "=this.shape[" + e + "]"
            }).join(",") + "," + o.map(function(e) {
                return "b" + e + "=this.stride[" + e + "]"
            }).join(",") + ",c=this.offset,d=0,ceil=Math.ceil");
            for (l = 0; l < t; ++l)
                i.push("if(typeof i" + l + "==='number'){d=i" + l + "|0;if(d<0){c+=b" + l + "*(a" + l + "-1);a" + l + "=ceil(-a" + l + "/d)}else{a" + l + "=ceil(a" + l + "/d)}b" + l + "*=d}");
            i.push("return new " + r + "(this.data," + o.map(function(e) {
                return "a" + e
            }).join(",") + "," + o.map(function(e) {
                return "b" + e
            }).join(",") + ",c)}");
            for (var u = new Array(t), h = new Array(t), l = 0; l < t; ++l)
                u[l] = "a[i" + l + "]",
                h[l] = "b[i" + l + "]";
            i.push("proto.transpose=function " + r + "_transpose(" + a + "){" + a.map(function(e, t) {
                return e + "=(" + e + "===undefined?" + t + ":" + e + "|0)"
            }).join(";"), "var a=this.shape,b=this.stride;return new " + r + "(this.data," + u.join(",") + "," + h.join(",") + ",this.offset)}"),
            i.push("proto.pick=function " + r + "_pick(" + a + "){var a=[],b=[],c=this.offset");
            for (l = 0; l < t; ++l)
                i.push("if(typeof i" + l + "==='number'&&i" + l + ">=0){c=(c+this.stride[" + l + "]*i" + l + ")|0}else{a.push(this.shape[" + l + "]);b.push(this.stride[" + l + "])}");
            return i.push("var ctor=CTOR_LIST[a.length+1];return ctor(this.data,a,b,c)}"),
            i.push("return function construct_" + r + "(data,shape,stride,offset){return new " + r + "(data," + o.map(function(e) {
                return "shape[" + e + "]"
            }).join(",") + "," + o.map(function(e) {
                return "stride[" + e + "]"
            }).join(",") + ",offset)}"),
            new Function("CTOR_LIST","ORDER",i.join("\n"))(v[e], p)
        }
        var v = {
            float32: [],
            float64: [],
            int8: [],
            int16: [],
            int32: [],
            uint8: [],
            uint16: [],
            uint32: [],
            array: [],
            uint8_clamped: [],
            bigint64: [],
            biguint64: [],
            buffer: [],
            generic: []
        };
        t.exports = function(e, t, r, n) {
            if (void 0 === e)
                return (0,
                v.array[0])([]);
            "number" == typeof e && (e = [e]);
            var i = (t = void 0 === t ? [e.length] : t).length;
            if (void 0 === r) {
                r = new Array(i);
                for (var o = i - 1, a = 1; 0 <= o; --o)
                    r[o] = a,
                    a *= t[o]
            }
            if (void 0 === n)
                for (o = n = 0; o < i; ++o)
                    r[o] < 0 && (n -= (t[o] - 1) * r[o]);
            for (var s = function(e) {
                if (f(e))
                    return "buffer";
                if (l)
                    switch (Object.prototype.toString.call(e)) {
                    case "[object Float64Array]":
                        return "float64";
                    case "[object Float32Array]":
                        return "float32";
                    case "[object Int8Array]":
                        return "int8";
                    case "[object Int16Array]":
                        return "int16";
                    case "[object Int32Array]":
                        return "int32";
                    case "[object Uint8Array]":
                        return "uint8";
                    case "[object Uint16Array]":
                        return "uint16";
                    case "[object Uint32Array]":
                        return "uint32";
                    case "[object Uint8ClampedArray]":
                        return "uint8_clamped";
                    case "[object BigInt64Array]":
                        return "bigint64";
                    case "[object BigUint64Array]":
                        return "biguint64"
                    }
                return Array.isArray(e) ? "array" : "generic"
            }(e), c = v[s]; c.length <= i + 1; )
                c.push(u(s, c.length - 1));
            return (0,
            c[i + 1])(e, t, r, n)
        }
    }
    , {
        "iota-array": 54,
        "is-buffer": 55
    }],
    59: [function(e, t, r) {
        "use strict";
        var c = Object.getOwnPropertySymbols
          , f = Object.prototype.hasOwnProperty
          , l = Object.prototype.propertyIsEnumerable;
        t.exports = function() {
            try {
                if (!Object.assign)
                    return;
                var e = new String("abc");
                if (e[5] = "de",
                "5" === Object.getOwnPropertyNames(e)[0])
                    return;
                for (var t = {}, r = 0; r < 10; r++)
                    t["_" + String.fromCharCode(r)] = r;
                if ("0123456789" !== Object.getOwnPropertyNames(t).map(function(e) {
                    return t[e]
                }).join(""))
                    return;
                var n = {};
                return "abcdefghijklmnopqrst".split("").forEach(function(e) {
                    n[e] = e
                }),
                "abcdefghijklmnopqrst" !== Object.keys(Object.assign({}, n)).join("") ? void 0 : 1
            } catch (e) {
                return
            }
        }() ? Object.assign : function(e, t) {
            for (var r, n = function(e) {
                if (null == e)
                    throw new TypeError("Object.assign cannot be called with null or undefined");
                return Object(e)
            }(e), i = 1; i < arguments.length; i++) {
                for (var o in r = Object(arguments[i]))
                    f.call(r, o) && (n[o] = r[o]);
                if (c)
                    for (var a = c(r), s = 0; s < a.length; s++)
                        l.call(r, a[s]) && (n[a[s]] = r[a[s]])
            }
            return n
        }
    }
    , {}],
    60: [function(e, r, n) {
        !(function(R) {
            !(function() {
                var e, t;
                e = this,
                t = function() {
                    "use strict";
                    function e(e) {
                        return i(a(e))
                    }
                    var l = Array.isArray || function(e) {
                        return "[object Array]" == Object.prototype.toString.call(e)
                    }
                      , o = f
                      , t = a
                      , r = i
                      , n = c
                      , u = new RegExp(["(\\\\.)", "([\\/.])?(?:(?:\\:(\\w+)(?:\\(((?:\\\\.|[^()])+)\\))?|\\(((?:\\\\.|[^()])+)\\))([+*?])?|(\\*))"].join("|"),"g");
                    function a(e) {
                        for (var t = [], r = 0, n = 0, i = ""; null != (a = u.exec(e)); ) {
                            var o, a, s, c = a[0], f = a[1], l = a.index;
                            i += e.slice(n, l),
                            n = l + c.length,
                            f ? i += f[1] : (i && (t.push(i),
                            i = ""),
                            s = a[2],
                            o = a[3],
                            l = a[4],
                            c = a[5],
                            f = a[6],
                            a = a[7],
                            t.push({
                                name: o || r++,
                                prefix: s || "",
                                delimiter: s = s || "/",
                                optional: "?" === f || "*" === f,
                                repeat: "+" === f || "*" === f,
                                pattern: (l || c || (a ? ".*" : "[^" + s + "]+?")).replace(/([=!:$\/()])/g, "\\$1")
                            }))
                        }
                        return n < e.length && (i += e.substr(n)),
                        i && t.push(i),
                        t
                    }
                    function i(c) {
                        for (var f = new Array(c.length), e = 0; e < c.length; e++)
                            "object" == typeof c[e] && (f[e] = new RegExp("^" + c[e].pattern + "$"));
                        return function(e) {
                            for (var t = "", r = e || {}, n = 0; n < c.length; n++) {
                                var i = c[n];
                                if ("string" != typeof i) {
                                    var o, a = r[i.name];
                                    if (null == a) {
                                        if (i.optional)
                                            continue;
                                        throw new TypeError('Expected "' + i.name + '" to be defined')
                                    }
                                    if (l(a)) {
                                        if (!i.repeat)
                                            throw new TypeError('Expected "' + i.name + '" to not repeat, but received "' + a + '"');
                                        if (0 === a.length) {
                                            if (i.optional)
                                                continue;
                                            throw new TypeError('Expected "' + i.name + '" to not be empty')
                                        }
                                        for (var s = 0; s < a.length; s++) {
                                            if (o = encodeURIComponent(a[s]),
                                            !f[n].test(o))
                                                throw new TypeError('Expected all "' + i.name + '" to match "' + i.pattern + '", but received "' + o + '"');
                                            t += (0 === s ? i.prefix : i.delimiter) + o
                                        }
                                    } else {
                                        if (o = encodeURIComponent(a),
                                        !f[n].test(o))
                                            throw new TypeError('Expected "' + i.name + '" to match "' + i.pattern + '", but received "' + o + '"');
                                        t += i.prefix + o
                                    }
                                } else
                                    t += i
                            }
                            return t
                        }
                    }
                    function h(e) {
                        return e.replace(/([.+*?=^!:${}()[\]|\/])/g, "\\$1")
                    }
                    function s(e, t) {
                        return e.keys = t,
                        e
                    }
                    function d(e) {
                        return e.sensitive ? "" : "i"
                    }
                    function c(e, t) {
                        for (var r = (t = t || {}).strict, n = !1 !== t.end, i = "", o = e[e.length - 1], o = "string" == typeof o && /\/$/.test(o), a = 0; a < e.length; a++) {
                            var s, c, f = e[a];
                            "string" == typeof f ? i += h(f) : (s = h(f.prefix),
                            c = f.pattern,
                            f.repeat && (c += "(?:" + s + c + ")*"),
                            i += c = f.optional ? s ? "(?:" + s + "(" + c + "))?" : "(" + c + ")?" : s + "(" + c + ")")
                        }
                        return r || (i = (o ? i.slice(0, -2) : i) + "(?:\\/(?=$))?"),
                        i += n ? "$" : r && o ? "" : "(?=\\/|$)",
                        new RegExp("^" + i,d(t))
                    }
                    function f(e, t, r) {
                        return l(t = t || []) ? r = r || {} : (r = t,
                        t = []),
                        e instanceof RegExp ? function(e, t) {
                            var r = e.source.match(/\((?!\?)/g);
                            if (r)
                                for (var n = 0; n < r.length; n++)
                                    t.push({
                                        name: n,
                                        prefix: null,
                                        delimiter: null,
                                        optional: !1,
                                        repeat: !1,
                                        pattern: null
                                    });
                            return s(e, t)
                        }(e, t) : (l(e) ? function(e, t, r) {
                            for (var n = [], i = 0; i < e.length; i++)
                                n.push(f(e[i], t, r).source);
                            return s(new RegExp("(?:" + n.join("|") + ")",d(r)), t)
                        }
                        : function(e, t, r) {
                            for (var n = a(e), i = c(n, r), o = 0; o < n.length; o++)
                                "string" != typeof n[o] && t.push(n[o]);
                            return s(i, t)
                        }
                        )(e, t, r)
                    }
                    o.parse = t,
                    o.compile = e,
                    o.tokensToFunction = r,
                    o.tokensToRegExp = n;
                    var p, v = "undefined" != typeof document, g = "undefined" != typeof window, y = "undefined" != typeof history, m = void 0 !== R, _ = v && document.ontouchstart ? "touchstart" : "click", x = g && !(!window.history.location && !window.location);
                    function b() {
                        this.callbacks = [],
                        this.exits = [],
                        this.current = "",
                        this.len = 0,
                        this._decodeURLComponents = !0,
                        this._base = "",
                        this._strict = !1,
                        this._running = !1,
                        this._hashbang = !1,
                        this.clickHandler = this.clickHandler.bind(this),
                        this._onpopstate = this._onpopstate.bind(this)
                    }
                    function E(e, t) {
                        if ("function" == typeof e)
                            return E.call(this, "*", e);
                        if ("function" == typeof t)
                            for (var r = new T(e,null,this), n = 1; n < arguments.length; ++n)
                                this.callbacks.push(r.middleware(arguments[n]));
                        else
                            "string" == typeof e ? this["string" == typeof t ? "redirect" : "show"](e, t) : this.start(e)
                    }
                    function w(e, t, r) {
                        var n = this.page = r || E
                          , i = n._window
                          , o = n._hashbang
                          , a = n._getBase()
                          , s = (e = "/" === e[0] && 0 !== e.indexOf(a) ? a + (o ? "#!" : "") + e : e).indexOf("?");
                        this.canonicalPath = e;
                        a = new RegExp("^" + a.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1"));
                        this.path = e.replace(a, "") || "/",
                        o && (this.path = this.path.replace("#!", "") || "/"),
                        this.title = v && i.document.title,
                        this.state = t || {},
                        this.state.path = e,
                        this.querystring = ~s ? n._decodeURLEncodedURIComponent(e.slice(s + 1)) : "",
                        this.pathname = n._decodeURLEncodedURIComponent(~s ? e.slice(0, s) : e),
                        this.params = {},
                        this.hash = "",
                        o || ~this.path.indexOf("#") && (o = this.path.split("#"),
                        this.path = this.pathname = o[0],
                        this.hash = n._decodeURLEncodedURIComponent(o[1]) || "",
                        this.querystring = this.querystring.split("#")[0])
                    }
                    function T(e, t, r) {
                        var n = this.page = r || A
                          , i = t || {};
                        i.strict = i.strict || n._strict,
                        this.path = "*" === e ? "(.*)" : e,
                        this.method = "GET",
                        this.regexp = o(this.path, this.keys = [], i)
                    }
                    b.prototype.configure = function(e) {
                        var t = e || {};
                        this._window = t.window || g && window,
                        this._decodeURLComponents = !1 !== t.decodeURLComponents,
                        this._popstate = !1 !== t.popstate && g,
                        this._click = !1 !== t.click && v,
                        this._hashbang = !!t.hashbang;
                        t = this._window;
                        this._popstate ? t.addEventListener("popstate", this._onpopstate, !1) : g && t.removeEventListener("popstate", this._onpopstate, !1),
                        this._click ? t.document.addEventListener(_, this.clickHandler, !1) : v && t.document.removeEventListener(_, this.clickHandler, !1),
                        this._hashbang && g && !y ? t.addEventListener("hashchange", this._onpopstate, !1) : g && t.removeEventListener("hashchange", this._onpopstate, !1)
                    }
                    ,
                    b.prototype.base = function(e) {
                        if (0 === arguments.length)
                            return this._base;
                        this._base = e
                    }
                    ,
                    b.prototype._getBase = function() {
                        var e = this._base;
                        if (e)
                            return e;
                        var t = g && this._window && this._window.location;
                        return e = g && this._hashbang && t && "file:" === t.protocol ? t.pathname : e
                    }
                    ,
                    b.prototype.strict = function(e) {
                        if (0 === arguments.length)
                            return this._strict;
                        this._strict = e
                    }
                    ,
                    b.prototype.start = function(e) {
                        var t, r = e || {};
                        this.configure(r),
                        !1 !== r.dispatch && (this._running = !0,
                        x && (t = this._window.location,
                        t = this._hashbang && ~t.hash.indexOf("#!") ? t.hash.substr(2) + t.search : this._hashbang ? t.search + t.hash : t.pathname + t.search + t.hash),
                        this.replace(t, null, !0, r.dispatch))
                    }
                    ,
                    b.prototype.stop = function() {
                        var e;
                        this._running && (this.current = "",
                        this.len = 0,
                        this._running = !1,
                        e = this._window,
                        this._click && e.document.removeEventListener(_, this.clickHandler, !1),
                        g && e.removeEventListener("popstate", this._onpopstate, !1),
                        g && e.removeEventListener("hashchange", this._onpopstate, !1))
                    }
                    ,
                    b.prototype.show = function(e, t, r, n) {
                        var i = new w(e,t,this)
                          , o = this.prevContext;
                        return this.prevContext = i,
                        this.current = i.path,
                        !1 !== r && this.dispatch(i, o),
                        !1 !== i.handled && !1 !== n && i.pushState(),
                        i
                    }
                    ,
                    b.prototype.back = function(e, t) {
                        var r, n = this;
                        0 < this.len ? (r = this._window,
                        y && r.history.back(),
                        this.len--) : e ? setTimeout(function() {
                            n.show(e, t)
                        }) : setTimeout(function() {
                            n.show(n._getBase(), t)
                        })
                    }
                    ,
                    b.prototype.redirect = function(e, t) {
                        var r = this;
                        "string" == typeof e && "string" == typeof t && E.call(this, e, function(e) {
                            setTimeout(function() {
                                r.replace(t)
                            }, 0)
                        }),
                        "string" == typeof e && void 0 === t && setTimeout(function() {
                            r.replace(e)
                        }, 0)
                    }
                    ,
                    b.prototype.replace = function(e, t, r, n) {
                        var i = new w(e,t,this)
                          , o = this.prevContext;
                        return this.prevContext = i,
                        this.current = i.path,
                        i.init = r,
                        i.save(),
                        !1 !== n && this.dispatch(i, o),
                        i
                    }
                    ,
                    b.prototype.dispatch = function(t, r) {
                        var n = 0
                          , i = 0
                          , o = this;
                        function a() {
                            var e = o.callbacks[n++];
                            if (t.path === o.current)
                                return e ? void e(t, a) : (function(e) {
                                    var t;
                                    e.handled || (t = this._window,
                                    (this._hashbang ? x && this._getBase() + t.location.hash.replace("#!", "") : x && t.location.pathname + t.location.search) !== e.canonicalPath && (this.stop(),
                                    e.handled = !1,
                                    x && (t.location.href = e.canonicalPath)))
                                }
                                ).call(o, t);
                            t.handled = !1
                        }
                        (r ? function e() {
                            var t = o.exits[i++];
                            if (!t)
                                return a();
                            t(r, e)
                        }
                        : a)()
                    }
                    ,
                    b.prototype.exit = function(e, t) {
                        if ("function" == typeof e)
                            return this.exit("*", e);
                        for (var r = new T(e,null,this), n = 1; n < arguments.length; ++n)
                            this.exits.push(r.middleware(arguments[n]))
                    }
                    ,
                    b.prototype.clickHandler = function(e) {
                        if (1 === this._which(e) && !(e.metaKey || e.ctrlKey || e.shiftKey || e.defaultPrevented)) {
                            var t, r, n, i = e.target, o = e.path || (e.composedPath ? e.composedPath() : null);
                            if (o)
                                for (var a = 0; a < o.length; a++)
                                    if (o[a].nodeName && "A" === o[a].nodeName.toUpperCase() && o[a].href) {
                                        i = o[a];
                                        break
                                    }
                            for (; i && "A" !== i.nodeName.toUpperCase(); )
                                i = i.parentNode;
                            i && "A" === i.nodeName.toUpperCase() && (n = "object" == typeof i.href && "SVGAnimatedString" === i.href.constructor.name,
                            i.hasAttribute("download") || "external" === i.getAttribute("rel") || (r = i.getAttribute("href"),
                            !this._hashbang && this._samePath(i) && (i.hash || "#" === r) || r && -1 < r.indexOf("mailto:") || (n ? i.target.baseVal : i.target) || (n || this.sameOrigin(i.href)) && (t = "/" !== (t = n ? i.href.baseVal : i.pathname + i.search + (i.hash || ""))[0] ? "/" + t : t,
                            r = t = m && t.match(/^\/[a-zA-Z]:\//) ? t.replace(/^\/[a-zA-Z]:\//, "/") : t,
                            n = this._getBase(),
                            0 === t.indexOf(n) && (t = t.substr(n.length)),
                            this._hashbang && (t = t.replace("#!", "")),
                            (!n || r !== t || x && "file:" === this._window.location.protocol) && (e.preventDefault(),
                            this.show(r)))))
                        }
                    }
                    ,
                    b.prototype._onpopstate = (p = !1,
                    g ? (v && "complete" === document.readyState ? p = !0 : window.addEventListener("load", function() {
                        setTimeout(function() {
                            p = !0
                        }, 0)
                    }),
                    function(e) {
                        var t;
                        p && (e.state ? (t = e.state.path,
                        this.replace(t, e.state)) : x && (t = this._window.location,
                        this.show(t.pathname + t.search + t.hash, void 0, void 0, !1)))
                    }
                    ) : function() {}
                    ),
                    b.prototype._which = function(e) {
                        return null == (e = e || g && this._window.event).which ? e.button : e.which
                    }
                    ,
                    b.prototype._toURL = function(e) {
                        var t = this._window;
                        if ("function" == typeof URL && x)
                            return new URL(e,t.location.toString());
                        if (v) {
                            t = t.document.createElement("a");
                            return t.href = e,
                            t
                        }
                    }
                    ,
                    b.prototype.sameOrigin = function(e) {
                        if (!e || !x)
                            return !1;
                        var t = this._toURL(e)
                          , r = this._window.location;
                        return r.protocol === t.protocol && r.hostname === t.hostname && (r.port === t.port || "" === r.port && (80 == t.port || 443 == t.port))
                    }
                    ,
                    b.prototype._samePath = function(e) {
                        if (!x)
                            return !1;
                        var t = this._window.location;
                        return e.pathname === t.pathname && e.search === t.search
                    }
                    ,
                    b.prototype._decodeURLEncodedURIComponent = function(e) {
                        return "string" == typeof e && this._decodeURLComponents ? decodeURIComponent(e.replace(/\+/g, " ")) : e
                    }
                    ,
                    w.prototype.pushState = function() {
                        var e = this.page
                          , t = e._window
                          , r = e._hashbang;
                        e.len++,
                        y && t.history.pushState(this.state, this.title, r && "/" !== this.path ? "#!" + this.path : this.canonicalPath)
                    }
                    ,
                    w.prototype.save = function() {
                        var e = this.page;
                        y && e._window.history.replaceState(this.state, this.title, e._hashbang && "/" !== this.path ? "#!" + this.path : this.canonicalPath)
                    }
                    ,
                    T.prototype.middleware = function(r) {
                        var n = this;
                        return function(e, t) {
                            if (n.match(e.path, e.params))
                                return e.routePath = n.path,
                                r(e, t);
                            t()
                        }
                    }
                    ,
                    T.prototype.match = function(e, t) {
                        var r = this.keys
                          , n = e.indexOf("?")
                          , n = ~n ? e.slice(0, n) : e
                          , i = this.regexp.exec(decodeURIComponent(n));
                        if (!i)
                            return !1;
                        delete t[0];
                        for (var o = 1, a = i.length; o < a; ++o) {
                            var s = r[o - 1]
                              , c = this.page._decodeURLEncodedURIComponent(i[o]);
                            void 0 === c && hasOwnProperty.call(t, s.name) || (t[s.name] = c)
                        }
                        return !0
                    }
                    ;
                    var A = function e() {
                        var t = new b;
                        function r() {
                            return E.apply(t, arguments)
                        }
                        return r.callbacks = t.callbacks,
                        r.exits = t.exits,
                        r.base = t.base.bind(t),
                        r.strict = t.strict.bind(t),
                        r.start = t.start.bind(t),
                        r.stop = t.stop.bind(t),
                        r.show = t.show.bind(t),
                        r.back = t.back.bind(t),
                        r.redirect = t.redirect.bind(t),
                        r.replace = t.replace.bind(t),
                        r.dispatch = t.dispatch.bind(t),
                        r.exit = t.exit.bind(t),
                        r.configure = t.configure.bind(t),
                        r.sameOrigin = t.sameOrigin.bind(t),
                        r.clickHandler = t.clickHandler.bind(t),
                        r.create = e,
                        Object.defineProperty(r, "len", {
                            get: function() {
                                return t.len
                            },
                            set: function(e) {
                                t.len = e
                            }
                        }),
                        Object.defineProperty(r, "current", {
                            get: function() {
                                return t.current
                            },
                            set: function(e) {
                                t.current = e
                            }
                        }),
                        r.Context = w,
                        r.Route = T,
                        r
                    }()
                      , n = A;
                    return n.default = A,
                    n
                }
                ,
                "object" == typeof n && void 0 !== r ? r.exports = t() : "function" == typeof define && define.amd ? define(t) : e.page = t()
            }
            ).call(this)
        }
        ).call(this, e("_process"))
    }
    , {
        _process: 62
    }],
    61: [function(e, s, t) {
        !(function(a) {
            !(function() {
                !(function() {
                    var e, t, r, n, i, o;
                    "undefined" != typeof performance && null !== performance && performance.now ? s.exports = function() {
                        return performance.now()
                    }
                    : null != a && a.hrtime ? (s.exports = function() {
                        return (e() - i) / 1e6
                    }
                    ,
                    t = a.hrtime,
                    n = (e = function() {
                        var e = t();
                        return 1e9 * e[0] + e[1]
                    }
                    )(),
                    o = 1e9 * a.uptime(),
                    i = n - o) : r = Date.now ? (s.exports = function() {
                        return Date.now() - r
                    }
                    ,
                    Date.now()) : (s.exports = function() {
                        return (new Date).getTime() - r
                    }
                    ,
                    (new Date).getTime())
                }
                ).call(this)
            }
            ).call(this)
        }
        ).call(this, e("_process"))
    }
    , {
        _process: 62
    }],
    62: [function(e, t, r) {
        var n, i, o = t.exports = {};
        function a() {
            throw new Error("setTimeout has not been defined")
        }
        function s() {
            throw new Error("clearTimeout has not been defined")
        }
        function c(t) {
            if (n === setTimeout)
                return setTimeout(t, 0);
            if ((n === a || !n) && setTimeout)
                return n = setTimeout,
                setTimeout(t, 0);
            try {
                return n(t, 0)
            } catch (e) {
                try {
                    return n.call(null, t, 0)
                } catch (e) {
                    return n.call(this, t, 0)
                }
            }
        }
        !function() {
            try {
                n = "function" == typeof setTimeout ? setTimeout : a
            } catch (e) {
                n = a
            }
            try {
                i = "function" == typeof clearTimeout ? clearTimeout : s
            } catch (e) {
                i = s
            }
        }();
        var f, l = [], u = !1, h = -1;
        function d() {
            u && f && (u = !1,
            f.length ? l = f.concat(l) : h = -1,
            l.length && p())
        }
        function p() {
            if (!u) {
                var e = c(d);
                u = !0;
                for (var t = l.length; t; ) {
                    for (f = l,
                    l = []; ++h < t; )
                        f && f[h].run();
                    h = -1,
                    t = l.length
                }
                f = null,
                u = !1,
                function(t) {
                    if (i === clearTimeout)
                        return clearTimeout(t);
                    if ((i === s || !i) && clearTimeout)
                        return i = clearTimeout,
                        clearTimeout(t);
                    try {
                        i(t)
                    } catch (e) {
                        try {
                            return i.call(null, t)
                        } catch (e) {
                            return i.call(this, t)
                        }
                    }
                }(e)
            }
        }
        function v(e, t) {
            this.fun = e,
            this.array = t
        }
        function g() {}
        o.nextTick = function(e) {
            var t = new Array(arguments.length - 1);
            if (1 < arguments.length)
                for (var r = 1; r < arguments.length; r++)
                    t[r - 1] = arguments[r];
            l.push(new v(e,t)),
            1 !== l.length || u || c(p)
        }
        ,
        v.prototype.run = function() {
            this.fun.apply(null, this.array)
        }
        ,
        o.title = "browser",
        o.browser = !0,
        o.env = {},
        o.argv = [],
        o.version = "",
        o.versions = {},
        o.on = g,
        o.addListener = g,
        o.once = g,
        o.off = g,
        o.removeListener = g,
        o.removeAllListeners = g,
        o.emit = g,
        o.prependListener = g,
        o.prependOnceListener = g,
        o.listeners = function(e) {
            return []
        }
        ,
        o.binding = function(e) {
            throw new Error("process.binding is not supported")
        }
        ,
        o.cwd = function() {
            return "/"
        }
        ,
        o.chdir = function(e) {
            throw new Error("process.chdir is not supported")
        }
        ,
        o.umask = function() {
            return 0
        }
    }
    , {}],
    63: [function(e, t, r) {
        var n = e("inherits")
          , i = e("events").EventEmitter
          , o = e("right-now")
          , a = e("raf");
        function s(e) {
            if (!(this instanceof s))
                return new s(e);
            this.running = !1,
            this.last = o(),
            this._frame = 0,
            this._tick = this.tick.bind(this),
            e && this.on("tick", e)
        }
        n(t.exports = s, i),
        s.prototype.start = function() {
            if (!this.running)
                return this.running = !0,
                this.last = o(),
                this._frame = a(this._tick),
                this
        }
        ,
        s.prototype.stop = function() {
            return this.running = !1,
            0 !== this._frame && a.cancel(this._frame),
            this._frame = 0,
            this
        }
        ,
        s.prototype.tick = function() {
            this._frame = a(this._tick);
            var e = o()
              , t = e - this.last;
            this.emit("tick", t),
            this.last = e
        }
    }
    , {
        events: 22,
        inherits: 53,
        raf: 64,
        "right-now": 66
    }],
    64: [function(u, h, e) {
        !(function(l) {
            !(function() {
                for (var n, i, o, a = u("performance-now"), t = "undefined" == typeof window ? l : window, e = ["moz", "webkit"], r = "AnimationFrame", s = t["request" + r], c = t["cancel" + r] || t["cancelRequest" + r], f = 0; !s && f < e.length; f++)
                    s = t[e[f] + "Request" + r],
                    c = t[e[f] + "Cancel" + r] || t[e[f] + "CancelRequest" + r];
                s && c || (i = n = 0,
                o = [],
                s = function(e) {
                    var t, r;
                    return 0 === o.length && (t = a(),
                    r = Math.max(0, 1e3 / 60 - (t - n)),
                    n = r + t,
                    setTimeout(function() {
                        for (var e = o.slice(0), t = o.length = 0; t < e.length; t++)
                            if (!e[t].cancelled)
                                try {
                                    e[t].callback(n)
                                } catch (e) {
                                    setTimeout(function() {
                                        throw e
                                    }, 0)
                                }
                    }, Math.round(r))),
                    o.push({
                        handle: ++i,
                        callback: e,
                        cancelled: !1
                    }),
                    i
                }
                ,
                c = function(e) {
                    for (var t = 0; t < o.length; t++)
                        o[t].handle === e && (o[t].cancelled = !0)
                }
                ),
                h.exports = function(e) {
                    return s.call(t, e)
                }
                ,
                h.exports.cancel = function() {
                    c.apply(t, arguments)
                }
                ,
                h.exports.polyfill = function(e) {
                    (e = e || t).requestAnimationFrame = s,
                    e.cancelAnimationFrame = c
                }
            }
            ).call(this)
        }
        ).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {})
    }
    , {
        "performance-now": 61
    }],
    65: [function(e, t, r) {
        "use strict";
        var n, i = "";
        t.exports = function(e, t) {
            if ("string" != typeof e)
                throw new TypeError("expected a string");
            if (1 === t)
                return e;
            if (2 === t)
                return e + e;
            var r = e.length * t;
            if (n !== e || void 0 === n)
                n = e,
                i = "";
            else if (i.length >= r)
                return i.substr(0, r);
            for (; r > i.length && 1 < t; )
                1 & t && (i += e),
                t >>= 1,
                e += e;
            return i = (i += e).substr(0, r)
        }
    }
    , {}],
    66: [function(e, t, r) {
        !(function(e) {
            !(function() {
                t.exports = e.performance && e.performance.now ? function() {
                    return performance.now()
                }
                : Date.now || function() {
                    return +new Date
                }
            }
            ).call(this)
        }
        ).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {})
    }
    , {}],
    67: [function(e, t, r) {
        !function() {
            "use strict";
            var d = {
                not_string: /[^s]/,
                not_bool: /[^t]/,
                not_type: /[^T]/,
                not_primitive: /[^v]/,
                number: /[diefg]/,
                numeric_arg: /[bcdiefguxX]/,
                json: /[j]/,
                not_json: /[^j]/,
                text: /^[^\x25]+/,
                modulo: /^\x25{2}/,
                placeholder: /^\x25(?:([1-9]\d*)\$|\(([^)]+)\))?(\+)?(0|'[^$])?(-)?(\d+)?(?:\.(\d+))?([b-gijostTuvxX])/,
                key: /^([a-z_][a-z_\d]*)/i,
                key_access: /^\.([a-z_][a-z_\d]*)/i,
                index_access: /^\[(\d+)\]/,
                sign: /^[+-]/
            };
            function p(e) {
                return function(e, t) {
                    var r, n, i, o, a, s, c, f, l = 1, u = e.length, h = "";
                    for (n = 0; n < u; n++)
                        if ("string" == typeof e[n])
                            h += e[n];
                        else if ("object" == typeof e[n]) {
                            if ((o = e[n]).keys)
                                for (r = t[l],
                                i = 0; i < o.keys.length; i++) {
                                    if (null == r)
                                        throw new Error(p('[sprintf] Cannot access property "%s" of undefined value "%s"', o.keys[i], o.keys[i - 1]));
                                    r = r[o.keys[i]]
                                }
                            else
                                r = o.param_no ? t[o.param_no] : t[l++];
                            if (d.not_type.test(o.type) && d.not_primitive.test(o.type) && r instanceof Function && (r = r()),
                            d.numeric_arg.test(o.type) && "number" != typeof r && isNaN(r))
                                throw new TypeError(p("[sprintf] expecting number but found %T", r));
                            switch (d.number.test(o.type) && (c = 0 <= r),
                            o.type) {
                            case "b":
                                r = parseInt(r, 10).toString(2);
                                break;
                            case "c":
                                r = String.fromCharCode(parseInt(r, 10));
                                break;
                            case "d":
                            case "i":
                                r = parseInt(r, 10);
                                break;
                            case "j":
                                r = JSON.stringify(r, null, o.width ? parseInt(o.width) : 0);
                                break;
                            case "e":
                                r = o.precision ? parseFloat(r).toExponential(o.precision) : parseFloat(r).toExponential();
                                break;
                            case "f":
                                r = o.precision ? parseFloat(r).toFixed(o.precision) : parseFloat(r);
                                break;
                            case "g":
                                r = o.precision ? String(Number(r.toPrecision(o.precision))) : parseFloat(r);
                                break;
                            case "o":
                                r = (parseInt(r, 10) >>> 0).toString(8);
                                break;
                            case "s":
                                r = String(r),
                                r = o.precision ? r.substring(0, o.precision) : r;
                                break;
                            case "t":
                                r = String(!!r),
                                r = o.precision ? r.substring(0, o.precision) : r;
                                break;
                            case "T":
                                r = Object.prototype.toString.call(r).slice(8, -1).toLowerCase(),
                                r = o.precision ? r.substring(0, o.precision) : r;
                                break;
                            case "u":
                                r = parseInt(r, 10) >>> 0;
                                break;
                            case "v":
                                r = r.valueOf(),
                                r = o.precision ? r.substring(0, o.precision) : r;
                                break;
                            case "x":
                                r = (parseInt(r, 10) >>> 0).toString(16);
                                break;
                            case "X":
                                r = (parseInt(r, 10) >>> 0).toString(16).toUpperCase()
                            }
                            d.json.test(o.type) ? h += r : (!d.number.test(o.type) || c && !o.sign ? f = "" : (f = c ? "+" : "-",
                            r = r.toString().replace(d.sign, "")),
                            a = o.pad_char ? "0" === o.pad_char ? "0" : o.pad_char.charAt(1) : " ",
                            s = o.width - (f + r).length,
                            s = o.width && 0 < s ? a.repeat(s) : "",
                            h += o.align ? f + r + s : "0" === a ? f + s + r : s + f + r)
                        }
                    return h
                }(function(e) {
                    if (c[e])
                        return c[e];
                    var t, r = e, n = [], i = 0;
                    for (; r; ) {
                        if (null !== (t = d.text.exec(r)))
                            n.push(t[0]);
                        else if (null !== (t = d.modulo.exec(r)))
                            n.push("%");
                        else {
                            if (null === (t = d.placeholder.exec(r)))
                                throw new SyntaxError("[sprintf] unexpected placeholder");
                            if (t[2]) {
                                i |= 1;
                                var o = []
                                  , a = t[2]
                                  , s = [];
                                if (null === (s = d.key.exec(a)))
                                    throw new SyntaxError("[sprintf] failed to parse named argument key");
                                for (o.push(s[1]); "" !== (a = a.substring(s[0].length)); )
                                    if (null !== (s = d.key_access.exec(a)))
                                        o.push(s[1]);
                                    else {
                                        if (null === (s = d.index_access.exec(a)))
                                            throw new SyntaxError("[sprintf] failed to parse named argument key");
                                        o.push(s[1])
                                    }
                                t[2] = o
                            } else
                                i |= 2;
                            if (3 === i)
                                throw new Error("[sprintf] mixing positional and named placeholders is not (yet) supported");
                            n.push({
                                placeholder: t[0],
                                param_no: t[1],
                                keys: t[2],
                                sign: t[3],
                                pad_char: t[4],
                                align: t[5],
                                width: t[6],
                                precision: t[7],
                                type: t[8]
                            })
                        }
                        r = r.substring(t[0].length)
                    }
                    return c[e] = n
                }(e), arguments)
            }
            function e(e, t) {
                return p.apply(null, [e].concat(t || []))
            }
            var c = Object.create(null);
            void 0 !== r && (r.sprintf = p,
            r.vsprintf = e),
            "undefined" != typeof window && (window.sprintf = p,
            window.vsprintf = e,
            "function" == typeof define && define.amd && define(function() {
                return {
                    sprintf: p,
                    vsprintf: e
                }
            }))
        }()
    }
    , {}],
    68: [function(A, e, R) {
        !(function(T) {
            !(function() {
                "use strict";
                var r = A("bit-twiddle")
                  , e = A("dup")
                  , n = A("buffer").Buffer;
                T.__TYPEDARRAY_POOL || (T.__TYPEDARRAY_POOL = {
                    UINT8: e([32, 0]),
                    UINT16: e([32, 0]),
                    UINT32: e([32, 0]),
                    BIGUINT64: e([32, 0]),
                    INT8: e([32, 0]),
                    INT16: e([32, 0]),
                    INT32: e([32, 0]),
                    BIGINT64: e([32, 0]),
                    FLOAT: e([32, 0]),
                    DOUBLE: e([32, 0]),
                    DATA: e([32, 0]),
                    UINT8C: e([32, 0]),
                    BUFFER: e([32, 0])
                });
                var t = "undefined" != typeof Uint8ClampedArray
                  , i = "undefined" != typeof BigUint64Array
                  , o = "undefined" != typeof BigInt64Array
                  , a = T.__TYPEDARRAY_POOL;
                a.UINT8C || (a.UINT8C = e([32, 0])),
                a.BIGUINT64 || (a.BIGUINT64 = e([32, 0])),
                a.BIGINT64 || (a.BIGINT64 = e([32, 0])),
                a.BUFFER || (a.BUFFER = e([32, 0]));
                var s = a.DATA
                  , c = a.BUFFER;
                function f(e) {
                    var t;
                    e && (t = e.length || e.byteLength,
                    t = r.log2(t),
                    s[t].push(e))
                }
                function l(e) {
                    var e = r.nextPow2(e)
                      , t = r.log2(e)
                      , t = s[t];
                    return 0 < t.length ? t.pop() : new ArrayBuffer(e)
                }
                function u(e) {
                    return new Uint8Array(l(e),0,e)
                }
                function h(e) {
                    return new Uint16Array(l(2 * e),0,e)
                }
                function d(e) {
                    return new Uint32Array(l(4 * e),0,e)
                }
                function p(e) {
                    return new Int8Array(l(e),0,e)
                }
                function v(e) {
                    return new Int16Array(l(2 * e),0,e)
                }
                function g(e) {
                    return new Int32Array(l(4 * e),0,e)
                }
                function y(e) {
                    return new Float32Array(l(4 * e),0,e)
                }
                function m(e) {
                    return new Float64Array(l(8 * e),0,e)
                }
                function _(e) {
                    return t ? new Uint8ClampedArray(l(e),0,e) : u(e)
                }
                function x(e) {
                    return i ? new BigUint64Array(l(8 * e),0,e) : null
                }
                function b(e) {
                    return o ? new BigInt64Array(l(8 * e),0,e) : null
                }
                function E(e) {
                    return new DataView(l(e),0,e)
                }
                function w(e) {
                    e = r.nextPow2(e);
                    var t = r.log2(e)
                      , t = c[t];
                    return 0 < t.length ? t.pop() : new n(e)
                }
                R.free = function(e) {
                    var t;
                    n.isBuffer(e) ? c[r.log2(e.length)].push(e) : (e = "[object ArrayBuffer]" !== Object.prototype.toString.call(e) ? e.buffer : e) && (t = e.length || e.byteLength,
                    t = 0 | r.log2(t),
                    s[t].push(e))
                }
                ,
                R.freeUint8 = R.freeUint16 = R.freeUint32 = R.freeBigUint64 = R.freeInt8 = R.freeInt16 = R.freeInt32 = R.freeBigInt64 = R.freeFloat32 = R.freeFloat = R.freeFloat64 = R.freeDouble = R.freeUint8Clamped = R.freeDataView = function(e) {
                    f(e.buffer)
                }
                ,
                R.freeArrayBuffer = f,
                R.freeBuffer = function(e) {
                    c[r.log2(e.length)].push(e)
                }
                ,
                R.malloc = function(e, t) {
                    if (void 0 === t || "arraybuffer" === t)
                        return l(e);
                    switch (t) {
                    case "uint8":
                        return u(e);
                    case "uint16":
                        return h(e);
                    case "uint32":
                        return d(e);
                    case "int8":
                        return p(e);
                    case "int16":
                        return v(e);
                    case "int32":
                        return g(e);
                    case "float":
                    case "float32":
                        return y(e);
                    case "double":
                    case "float64":
                        return m(e);
                    case "uint8_clamped":
                        return _(e);
                    case "bigint64":
                        return b(e);
                    case "biguint64":
                        return x(e);
                    case "buffer":
                        return w(e);
                    case "data":
                    case "dataview":
                        return E(e);
                    default:
                        return null
                    }
                    return null
                }
                ,
                R.mallocArrayBuffer = l,
                R.mallocUint8 = u,
                R.mallocUint16 = h,
                R.mallocUint32 = d,
                R.mallocInt8 = p,
                R.mallocInt16 = v,
                R.mallocInt32 = g,
                R.mallocFloat32 = R.mallocFloat = y,
                R.mallocFloat64 = R.mallocDouble = m,
                R.mallocUint8Clamped = _,
                R.mallocBigUint64 = x,
                R.mallocBigInt64 = b,
                R.mallocDataView = E,
                R.mallocBuffer = w,
                R.clearCache = function() {
                    for (var e = 0; e < 32; ++e)
                        a.UINT8[e].length = 0,
                        a.UINT16[e].length = 0,
                        a.UINT32[e].length = 0,
                        a.INT8[e].length = 0,
                        a.INT16[e].length = 0,
                        a.INT32[e].length = 0,
                        a.FLOAT[e].length = 0,
                        a.DOUBLE[e].length = 0,
                        a.BIGUINT64[e].length = 0,
                        a.BIGINT64[e].length = 0,
                        a.UINT8C[e].length = 0,
                        s[e].length = 0,
                        c[e].length = 0
                }
            }
            ).call(this)
        }
        ).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {})
    }
    , {
        "bit-twiddle": 13,
        buffer: 14,
        dup: 20
    }],
    69: [function(e, t, r) {
        "use strict";
        t.exports = function(e, t, r) {
            return 0 === e.length ? e : t ? (r || e.sort(t),
            function(e, t) {
                for (var r, n = 1, i = e.length, o = e[0], a = (e[0],
                1); a < i; ++a)
                    r = o,
                    t(o = e[a], r) && (a !== n ? e[n++] = o : n++);
                return e.length = n,
                e
            }(e, t)) : (r || e.sort(),
            function(e) {
                for (var t = 1, r = e.length, n = e[0], i = e[0], o = 1; o < r; ++o,
                i = n)
                    i = n,
                    (n = e[o]) !== i && (o !== t ? e[t++] = n : t++);
                return e.length = t,
                e
            }(e))
        }
    }
    , {}],
    70: [function(e, _, t) {
        !function() {
            "use strict";
            if ("undefined" == typeof ses || !ses.ok || ses.ok()) {
                "undefined" != typeof ses && (ses.weakMapPermitHostObjects = d);
                var t = !1;
                if ("function" == typeof WeakMap) {
                    var r = WeakMap;
                    if ("undefined" == typeof navigator || !/Firefox/.test(navigator.userAgent)) {
                        var e = new r
                          , n = Object.freeze({});
                        if (e.set(n, 1),
                        1 === e.get(n))
                            return _.exports = WeakMap;
                        t = !0
                    }
                }
                Object.prototype.hasOwnProperty;
                var i, o = Object.getOwnPropertyNames, a = Object.defineProperty, s = Object.isExtensible, c = "weakmap:", f = c + "ident:" + Math.random() + "___";
                "undefined" != typeof crypto && "function" == typeof crypto.getRandomValues && "function" == typeof ArrayBuffer && "function" == typeof Uint8Array && (n = new ArrayBuffer(25),
                n = new Uint8Array(n),
                crypto.getRandomValues(n),
                f = c + "rand:" + Array.prototype.map.call(n, function(e) {
                    return (e % 36).toString(36)
                }).join("") + "___"),
                a(Object, "getOwnPropertyNames", {
                    value: function(e) {
                        return o(e).filter(p)
                    }
                }),
                "getPropertyNames"in Object && (i = Object.getPropertyNames,
                a(Object, "getPropertyNames", {
                    value: function(e) {
                        return i(e).filter(p)
                    }
                })),
                function() {
                    var t = Object.freeze;
                    a(Object, "freeze", {
                        value: function(e) {
                            return v(e),
                            t(e)
                        }
                    });
                    var r = Object.seal;
                    a(Object, "seal", {
                        value: function(e) {
                            return v(e),
                            r(e)
                        }
                    });
                    var n = Object.preventExtensions;
                    a(Object, "preventExtensions", {
                        value: function(e) {
                            return v(e),
                            n(e)
                        }
                    })
                }();
                var l = !1
                  , u = 0
                  , h = function() {
                    this instanceof h || y();
                    var n = []
                      , i = []
                      , o = u++;
                    return Object.create(h.prototype, {
                        get___: {
                            value: g(function(e, t) {
                                var r = v(e);
                                return r ? o in r ? r[o] : t : 0 <= (r = n.indexOf(e)) ? i[r] : t
                            })
                        },
                        has___: {
                            value: g(function(e) {
                                var t = v(e);
                                return t ? o in t : 0 <= n.indexOf(e)
                            })
                        },
                        set___: {
                            value: g(function(e, t) {
                                var r = v(e);
                                return r ? r[o] = t : 0 <= (r = n.indexOf(e)) ? i[r] = t : (r = n.length,
                                i[r] = t,
                                n[r] = e),
                                this
                            })
                        },
                        delete___: {
                            value: g(function(e) {
                                var t, r = v(e);
                                return r ? o in r && delete r[o] : !((t = n.indexOf(e)) < 0) && (r = n.length - 1,
                                n[t] = void 0,
                                i[t] = i[r],
                                n[t] = n[r],
                                n.length = r,
                                i.length = r,
                                !0)
                            })
                        }
                    })
                };
                h.prototype = Object.create(Object.prototype, {
                    get: {
                        value: function(e, t) {
                            return this.get___(e, t)
                        },
                        writable: !0,
                        configurable: !0
                    },
                    has: {
                        value: function(e) {
                            return this.has___(e)
                        },
                        writable: !0,
                        configurable: !0
                    },
                    set: {
                        value: function(e, t) {
                            return this.set___(e, t)
                        },
                        writable: !0,
                        configurable: !0
                    },
                    delete: {
                        value: function(e) {
                            return this.delete___(e)
                        },
                        writable: !0,
                        configurable: !0
                    }
                }),
                "function" == typeof r ? (t && "undefined" != typeof Proxy && (Proxy = void 0),
                m.prototype = h.prototype,
                _.exports = m,
                Object.defineProperty(WeakMap.prototype, "constructor", {
                    value: WeakMap,
                    enumerable: !1,
                    configurable: !0,
                    writable: !0
                })) : ("undefined" != typeof Proxy && (Proxy = void 0),
                _.exports = h)
            }
            function d(e) {
                e.permitHostObjects___ && e.permitHostObjects___(d)
            }
            function p(e) {
                return !(e.substr(0, c.length) == c && "___" === e.substr(e.length - 3))
            }
            function v(e) {
                if (e !== Object(e))
                    throw new TypeError("Not an object: " + e);
                var t = e[f];
                if (t && t.key === e)
                    return t;
                if (s(e)) {
                    t = {
                        key: e
                    };
                    try {
                        return a(e, f, {
                            value: t,
                            writable: !1,
                            enumerable: !1,
                            configurable: !1
                        }),
                        t
                    } catch (e) {
                        return
                    }
                }
            }
            function g(e) {
                return e.prototype = null,
                Object.freeze(e)
            }
            function y() {
                l || "undefined" == typeof console || (l = !0,
                console.warn("WeakMap should be invoked as new WeakMap(), not WeakMap(). This will be an error in the future."))
            }
            function m() {
                this instanceof h || y();
                var e, n = new r, i = void 0, o = !1;
                return e = t ? function(e, t) {
                    return n.set(e, t),
                    n.has(e) || (i = i || new h).set(e, t),
                    this
                }
                : function(t, r) {
                    if (o)
                        try {
                            n.set(t, r)
                        } catch (e) {
                            (i = i || new h).set___(t, r)
                        }
                    else
                        n.set(t, r);
                    return this
                }
                ,
                Object.create(h.prototype, {
                    get___: {
                        value: g(function(e, t) {
                            return i ? n.has(e) ? n.get(e) : i.get___(e, t) : n.get(e, t)
                        })
                    },
                    has___: {
                        value: g(function(e) {
                            return n.has(e) || !!i && i.has___(e)
                        })
                    },
                    set___: {
                        value: g(e)
                    },
                    delete___: {
                        value: g(function(e) {
                            var t = !!n.delete(e);
                            return i && i.delete___(e) || t
                        })
                    },
                    permitHostObjects___: {
                        value: g(function(e) {
                            if (e !== d)
                                throw new Error("bogus call to permitHostObjects___");
                            o = !0
                        })
                    }
                })
            }
        }()
    }
    , {}],
    71: [function(e, t, r) {
        var n = e("./hidden-store.js");
        t.exports = function() {
            var r = {};
            return function(e) {
                if (("object" != typeof e || null === e) && "function" != typeof e)
                    throw new Error("Weakmap-shim: Key must be object");
                var t = e.valueOf(r);
                return t && t.identity === r ? t : n(e, r)
            }
        }
    }
    , {
        "./hidden-store.js": 72
    }],
    72: [function(e, t, r) {
        t.exports = function(e, t) {
            var r = {
                identity: t
            }
              , n = e.valueOf;
            return Object.defineProperty(e, "valueOf", {
                value: function(e) {
                    return e !== t ? n.apply(this, arguments) : r
                },
                writable: !0
            }),
            r
        }
    }
    , {}],
    73: [function(e, t, r) {
        var i = e("./create-store.js");
        t.exports = function() {
            var n = i();
            return {
                get: function(e, t) {
                    var r = n(e);
                    return r.hasOwnProperty("value") ? r.value : t
                },
                set: function(e, t) {
                    return n(e).value = t,
                    this
                },
                has: function(e) {
                    return "value"in n(e)
                },
                delete: function(e) {
                    return delete n(e).value
                }
            }
        }
    }
    , {
        "./create-store.js": 71
    }],
    74: [function(e, t, r) {
        var n = e("get-canvas-context");
        t.exports = function(e) {
            return n("webgl", e)
        }
    }
    , {
        "get-canvas-context": 23
    }]
}, {}, [1]);
