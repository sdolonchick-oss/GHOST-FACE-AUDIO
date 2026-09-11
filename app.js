let ctx = null;
let stream = null;
let source = null;
let inputGain = null;
let master = null;
let analyser = null;
let delayNode = null;
let feedback = null;
let distortion = null;
let running = false;
let raf = null;

const $ = id => document.getElementById(id);
const ids = ["pitch", "gain", "dark", "dist", "echo", "delay"];

function labels() {
    $("pitchV").textContent = Number($("pitch").value).toFixed(2) + "×";
    $("gainV").textContent = Number($("gain").value).toFixed(1) + "×";
    $("darkV").textContent = $("dark").value + "%";
    $("distV").textContent = $("dist").value + "%";
    $("echoV").textContent = $("echo").value + "%";
    $("delayV").textContent = Number($("delay").value).toFixed(2) + "s";
}

ids.forEach(id => {
    const el = $(id);
    if (el) {
        el.addEventListener("input", labels);
    }
});

labels();

function makeCurve(amount) {
    const n = 44100;
    const curve = new Float32Array(n);
    const k = Number(amount) * 25;

    for (let i = 0; i < n; i++) {
        const x = i * 2 / n - 1;
        curve[i] = k === 0 ? x : Math.tanh(k * x) / Math.tanh(k);
    }

    return curve;
}

function applySettings() {
    if (!ctx) return;

    const now = ctx.currentTime;

    const pitch = Number($("pitch").value);
    const gain = Number($("gain").value);
    const dark = Number($("dark").value);
    const dist = Number($("dist").value);
    const echo = Number($("echo").value);
    const delay = Number($("delay").value);

    // Громкость
    inputGain.gain.setTargetAtTime(gain, now, 0.02);

    // Низкие частоты
    low.frequency.setTargetAtTime(
        180 + (dark * 4),
        now,
        0.03
    );

    // Высокие частоты
    high.frequency.setTargetAtTime(
        1900 - (dark * 15),
        now,
        0.03
    );

    // Изменение высоты голоса
    if (source) {
        source.playbackRate.value = Math.max(0.45, Math.min(2.0, pitch));
    }

    // Дисторшн
    distortion.curve = makeCurve(dist);

    // Echo
    delayNode.delayTime.setTargetAtTime(
        Math.max(0, Math.min(5, delay)),
        now,
        0.03
    );

    feedback.gain.setTargetAtTime(
        Math.min(0.85, echo / 100),
        now,
        0.03
    );
}

async function start() {
    if (running) {
        stop();
        return;
    }

    try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();

        if (ctx.state === "suspended") {
            await ctx.resume();
        }

        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        source = ctx.createMediaStreamSource(stream);

        inputGain = ctx.createGain();
        master = ctx.createGain();

        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;

        low = ctx.createBiquadFilter();
        low.type = "lowshelf";
        low.frequency.value = 220;

        high = ctx.createBiquadFilter();
        high.type = "highshelf";
        high.frequency.value = 1900;

        distortion = ctx.createWaveShaper();
        distortion.oversample = "4x";

        delayNode = ctx.createDelay(5);
        feedback = ctx.createGain();

        // Основная цепочка
        source.connect(inputGain);
        inputGain.connect(low);
        low.connect(high);
        high.connect(distortion);

        // Анализатор
        distortion.connect(analyser);

        // Прямая дорожка
        distortion.connect(master);

        // Echo / delay
        distortion.connect(delayNode);
        delayNode.connect(feedback);
        feedback.connect(delayNode);
        delayNode.connect(master);

        master.connect(ctx.destination);

        applySettings();

        running = true;

        $("power").textContent = "🛑 STOP VOICE";
        $("state").textContent = "ONLINE";

        draw();

    } catch (err) {
        console.error(err);

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }

        if (ctx) {
            try {
                await ctx.close();
            } catch (e) {}
        }

        ctx = null;
        stream = null;
        running = false;

        alert(
            "Микрофон не открылся.\n\n" +
            "Разреши браузеру доступ к микрофону и попробуй ещё раз."
        );
    }
}

function stop() {
    running = false;

    if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
    }

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    if (ctx) {
        ctx.close();
        ctx = null;
    }

    source = null;
    inputGain = null;
    master = null;
    analyser = null;
    delayNode = null;
    feedback = null;
    distortion = null;

    $("power").textContent = "🎙️ START VOICE";
    $("state").textContent = "OFFLINE";
    $("levelText").textContent = "000";

    document.querySelectorAll(".bar").forEach(b => {
        b.style.height = "5%";
    });
}

function draw() {
    if (!running || !analyser) return;

    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    let sum = 0;

    for (let i = 0; i < data.length; i++) {
        sum += Math.abs(data[i] - 128);
    }

    const level = Math.min(
        100,
        Math.round((sum / data.length) * 1.8)
    );

    $("levelText").textContent =
        String(level).padStart(3, "0");

    const bars = document.querySelectorAll(".bar");

    bars.forEach((bar, i) => {
        const index =
            Math.floor(i * data.length / bars.length);

        const value =
            Math.abs(data[index] - 128) / 128;

        bar.style.height =
            Math.max(5, Math.min(100, value * 220)) + "%";
    });

    raf = requestAnimationFrame(draw);
}

$("power").addEventListener("click", start);

const presets = {
    killer: [0.72, 1.55, 45, 18, 03, 1.0],
    ghost:  [1.12, 1.25, 28, 65, 16, 1.3],
    demon:  [0.48, 2.3, 85, 70, 30, 0.4],
    robot:  [1.1, 1.25, 15, 80, 85, 0.2],
    deep:   [0.55, 1.8, 70, 20, 10, 0.0],
    whisper:[1.48, 0.42, 65, 75, 90, 1.0]
};

document.querySelectorAll("[data-p]").forEach(button => {
    button.addEventListener("click", () => {
        const p = presets[button.dataset.p];

        if (!p) return;

        $("pitch").value = p[0];
        $("gain").value = p[1];
        $("dark").value = p[2];
        $("dist").value = p[3];
        $("echo").value = p[4];
        $("delay").value = p[5];

        labels();

        if (running) {
            applySettings();
        }
    });
});

const barsBox = $("bars");

if (barsBox) {
    for (let i = 0; i < 48; i++) {
        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.height = "5%";
        barsBox.appendChild(bar);
    }
    }
