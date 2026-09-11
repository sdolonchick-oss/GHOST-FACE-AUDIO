let ctx = null;
let stream = null;

let source = null;
let inputGain = null;
let master = null;
let analyser = null;

let low = null;
let high = null;
let distortion = null;
let delayNode = null;
let feedback = null;

let running = false;
let raf = null;

const $ = id => document.getElementById(id);

const ids = ["pitch", "gain", "dark", "dist", "echo", "delay"];

function labels() {
    if ($("pitch")) $("pitchV").textContent =
        Number($("pitch").value).toFixed(2) + "×";

    if ($("gain")) $("gainV").textContent =
        Number($("gain").value).toFixed(2) + "×";

    if ($("dark")) $("darkV").textContent =
        Number($("dark").value) + "%";

    if ($("dist")) $("distV").textContent =
        Number($("dist").value) + "%";

    if ($("echo")) $("echoV").textContent =
        Number($("echo").value) + "%";

    if ($("delay")) $("delayV").textContent =
        Number($("delay").value).toFixed(2) + "s";
}

function makeCurve(amount) {
    const n = 44100;
    const curve = new Float32Array(n);
    const k = Number(amount) * 25;

    for (let i = 0; i < n; i++) {
        const x = i * 2 / n - 1;

        if (k === 0) {
            curve[i] = x;
        } else {
            curve[i] = Math.tanh(k * x) / Math.tanh(k);
        }
    }

    return curve;
}

function applySettings() {
    if (!ctx || !running) return;

    const now = ctx.currentTime;

    const pitch = Number($("pitch")?.value || 1);
    const gain = Number($("gain")?.value || 1);
    const dark = Number($("dark")?.value || 0);
    const dist = Number($("dist")?.value || 0);

    // Echo специально ограничиваем
    const echo = Math.min(
        Number($("echo")?.value || 0),
        25
    );

    const delay = Math.min(
        Number($("delay")?.value || 0),
        1
    );

    if (inputGain) {
        inputGain.gain.setTargetAtTime(
            Math.min(gain, 1.5),
            now,
            0.03
        );
    }

    if (low) {
        low.frequency.setTargetAtTime(
            180 + dark * 4,
            now,
            0.03
        );
    }

    if (high) {
        high.frequency.setTargetAtTime(
            Math.max(700, 1900 - dark * 15),
            now,
            0.03
        );
    }

    if (distortion) {
        distortion.curve = makeCurve(dist);
    }

    if (delayNode) {
        delayNode.delayTime.setTargetAtTime(
            delay,
            now,
            0.03
        );
    }

    if (feedback) {
        feedback.gain.setTargetAtTime(
            echo / 100,
            now,
            0.03
        );
    }
}

async function start() {
    if (running) {
        await stop();
        return;
    }

    try {
        if (!navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia) {
            throw new Error(
                "Браузер не поддерживает микрофон."
            );
        }

        const AudioContext =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioContext) {
            throw new Error(
                "Web Audio не поддерживается."
            );
        }

        ctx = new AudioContext();

        if (ctx.state === "suspended") {
            await ctx.resume();
        }

        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1
            },
            video: false
        });

        source = ctx.createMediaStreamSource(stream);

        inputGain = ctx.createGain();
        master = ctx.createGain();
        analyser = ctx.createAnalyser();

        analyser.fftSize = 1024;

        // ВАЖНО:
        // Очень тихий выход, чтобы телефон не заводился.
        master.gain.value = 0.18;

        low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.value = 220;
        low.Q.value = 0.7;

        high = ctx.createBiquadFilter();
        high.type = "highshelf";
        high.frequency.value = 1900;
        high.gain.value = 0;

        distortion = ctx.createWaveShaper();
        distortion.oversample = "4x";
        distortion.curve = makeCurve(
            Number($("dist")?.value || 0)
        );

        delayNode = ctx.createDelay(5);
        feedback = ctx.createGain();

        // Echo по умолчанию полностью выключен
        feedback.gain.value = 0;

        // Микрофон
        source.connect(inputGain);

        // Основная цепочка
        inputGain.connect(low);
        low.connect(high);
        high.connect(distortion);

        // Основной звук
        distortion.connect(master);

        // Echo-цепочка
        distortion.connect(delayNode);
        delayNode.connect(feedback);
        feedback.connect(delayNode);
        delayNode.connect(master);

        // Анализатор
        distortion.connect(analyser);

        // Выход
        master.connect(ctx.destination);

        running = true;

        applySettings();

        if ($("power")) {
            $("power").textContent = "⏹ STOP VOICE";
        }

        if ($("state")) {
            $("state").textContent = "ONLINE";
        }

        draw();

    } catch (err) {

        console.error(err);

        if (stream) {
            stream.getTracks().forEach(track => {
                try {
                    track.stop();
                } catch (e) {}
            });
        }

        stream = null;

        if (ctx) {
            try {
                await ctx.close();
            } catch (e) {}
        }

        ctx = null;
        running = false;

        alert(
            "Микрофон не открылся.\n\n" +
            "Проверь разрешение микрофона для сайта.\n\n" +
            "Ошибка: " +
            (err.message || err.name || "unknown")
        );
    }
}

async function stop() {
    running = false;

    if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
    }

    if (stream) {
        stream.getTracks().forEach(track => {
            try {
                track.stop();
            } catch (e) {}
        });

        stream = null;
    }

    if (ctx) {
        try {
            await ctx.close();
        } catch (e) {}
    }

    ctx = null;

    source = null;
    inputGain = null;
    master = null;
    analyser = null;
    low = null;
    high = null;
    distortion = null;
    delayNode = null;
    feedback = null;

    if ($("power")) {
        $("power").textContent = "🎙 START VOICE";
    }

    if ($("state")) {
        $("state").textContent = "OFFLINE";
    }

    if ($("levelText")) {
        $("levelText").textContent = "000";
    }

    document.querySelectorAll(".bar").forEach(bar => {
        bar.style.height = "5%";
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

    if ($("levelText")) {
        $("levelText").textContent =
            String(level).padStart(3, "0");
    }

    const bars = document.querySelectorAll(".bar");

    bars.forEach((bar, i) => {
        const index = Math.floor(
            i * data.length /
            Math.max(1, bars.length)
        );

        const value =
            Math.abs(data[index] - 128) / 128;

        bar.style.height =
            Math.max(
                5,
                Math.min(100, value * 220)
            ) + "%";
    });

    raf = requestAnimationFrame(draw);
}

// Кнопка START/STOP
if ($("power")) {
    $("power").addEventListener("click", start);
}

// Ползунки
ids.forEach(id => {
    const element = $(id);

    if (element) {
        element.addEventListener("input", () => {
            labels();

            if (running) {
                applySettings();
            }
        });
    }
});

labels();

// Пресеты
const presets = {
    killer: [0.72, 1.20, 45, 18, 0, 0],
    ghost: [1.12, 1.10, 28, 65, 0, 0],
    demon: [0.48, 1.40, 85, 70, 0, 0],
    robot: [1.10, 1.15, 15, 80, 0, 0],
    deep: [0.55, 1.20, 70, 20, 0, 0],
    whisper: [1.48, 0.60, 65, 75, 0, 0]
};

document.querySelectorAll("[data-p]").forEach(button => {

    button.addEventListener("click", () => {

        const p = presets[button.dataset.p];

        if (!p) return;

        if ($("pitch")) $("pitch").value = p[0];
        if ($("gain")) $("gain").value = p[1];
        if ($("dark")) $("dark").value = p[2];
        if ($("dist")) $("dist").value = p[3];
        if ($("echo")) $("echo").value = p[4];
        if ($("delay")) $("delay").value = p[5];

        labels();

        if (running) {
            applySettings();
        }
    });
});

// Индикаторы
const barsBox = $("bars");

if (barsBox && barsBox.children.length === 0) {

    for (let i = 0; i < 48; i++) {

        const bar = document.createElement("div");

        bar.className = "bar";
        bar.style.height = "5%";

        barsBox.appendChild(bar);
    }
}

// Начальное состояние
if ($("state")) {
    $("state").textContent = "OFFLINE";
}

if ($("levelText")) {
    $("levelText").textContent = "000";
}

console.log("GHOST FACE AUDIO READY");,
