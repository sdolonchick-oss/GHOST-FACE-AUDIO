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

const $ = (id) => document.getElementById(id);

const ids = ["pitch", "gain", "dark", "dist", "echo", "delay"];

function labels() {
    const pitch = $("pitch");
    const gain = $("gain");
    const dark = $("dark");
    const dist = $("dist");
    const echo = $("echo");
    const delay = $("delay");

    if (pitch) $("pitchV").textContent = Number(pitch.value).toFixed(2) + "×";
    if (gain) $("gainV").textContent = Number(gain.value).toFixed(2) + "×";
    if (dark) $("darkV").textContent = Number(dark.value) + "%";
    if (dist) $("distV").textContent = Number(dist.value) + "%";
    if (echo) $("echoV").textContent = Number(echo.value) + "%";
    if (delay) $("delayV").textContent = Number(delay.value).toFixed(2) + "s";
}

ids.forEach(id => {
    const el = $(id);
    if (el) el.addEventListener("input", labels);
});

labels();

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
    const echo = Number($("echo")?.value || 0);
    const delay = Number($("delay")?.value || 0);

    if (inputGain) {
        inputGain.gain.setTargetAtTime(
            gain,
            now,
            0.02
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

    if (source) {
        try {
            source.playbackRate.value =
                Math.max(0.45, Math.min(2.0, pitch));
        } catch (e) {
            console.log("Playback rate unavailable");
        }
    }

    if (distortion) {
        distortion.curve = makeCurve(dist);
    }

    if (delayNode) {
        delayNode.delayTime.setTargetAtTime(
            Math.max(0, Math.min(5, delay)),
            now,
            0.03
        );
    }

    if (feedback) {
        feedback.gain.setTargetAtTime(
            Math.min(0.85, echo / 100),
            now,
            0.03
        );
    }
}

async function start() {
    if (running) {
        stop();
        return;
    }

    try {
        // Проверяем поддержку микрофона
        if (!navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia) {

            throw new Error(
                "Браузер не поддерживает доступ к микрофону."
            );
        }

        // Создаём AudioContext
        const AudioContext =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioContext) {
            throw new Error(
                "Браузер не поддерживает Web Audio."
            );
        }

        ctx = new AudioContext();

        // На Android AudioContext иногда запускается suspended
        if (ctx.state === "suspended") {
            await ctx.resume();
        }

        // Запрашиваем микрофон
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1
            },
            video: false
        });

        // Источник микрофона
        source = ctx.createMediaStreamSource(stream);

        inputGain = ctx.createGain();
        master = ctx.createGain();
        analyser = ctx.createAnalyser();

        analyser.fftSize = 1024;

        // Фильтр низких частот
        low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.value = 220;
        low.Q.value = 0.7;

        // Фильтр высоких частот
        high = ctx.createBiquadFilter();
        high.type = "highshelf";
        high.frequency.value = 1900;
        high.gain.value = 0;

        // Distortion
        distortion = ctx.createWaveShaper();
        distortion.oversample = "4x";
        distortion.curve = makeCurve(
            Number($("dist")?.value || 0)
        );

        // Echo
        delayNode = ctx.createDelay(5.0);
        feedback = ctx.createGain();

        // Подключение
        source.connect(inputGain);

        inputGain.connect(low);
        low.connect(high);
        high.connect(distortion);

        // Основной звук
        distortion.connect(master);

        // Echo
        distortion.connect(delayNode);
        delayNode.connect(feedback);
        feedback.connect(delayNode);
        delayNode.connect(master);

        // Анализатор
        distortion.connect(analyser);

        // Выход
        master.connect(ctx.destination);

        applySettings();

        running = true;

        const power = $("power");
        const state = $("state");

        if (power) {
            power.textContent = "⏹ STOP VOICE";
        }

        if (state) {
            state.textContent = "ONLINE";
        }

        draw();

    } catch (err) {

        console.error("MICROPHONE ERROR:", err);

        // Останавливаем всё, если запуск не удался
        if (stream) {
            stream.getTracks().forEach(track => {
                try {
                    track.stop();
                } catch (e) {}
            });
        }

        stream = null;
        source = null;

        if (ctx) {
            try {
                await ctx.close();
            } catch (e) {}
        }

        ctx = null;
        running = false;

        const message =
            "Микрофон не открылся.\n\n" +
            "Проверь разрешение микрофона для сайта " +
            "и нажми START VOICE ещё раз.\n\n" +
            "Ошибка: " +
            (err.message || err.name || "unknown");

        alert(message);
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

    const power = $("power");
    const state = $("state");
    const levelText = $("levelText");

    if (power) {
        power.textContent = "🎙 START VOICE";
    }

    if (state) {
        state.textContent = "OFFLINE";
    }

    if (levelText) {
        levelText.textContent = "000";
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

    const levelText = $("levelText");

    if (levelText) {
        levelText.textContent =
            String(level).padStart(3, "0");
    }

    const bars = document.querySelectorAll(".bar");

    bars.forEach((bar, i) => {
        const index = Math.floor(
            i * data.length / Math.max(1, bars.length)
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

// Кнопка запуска
const powerButton = $("power");

if (powerButton) {
    powerButton.addEventListener("click", start);
}

// Пресеты
const presets = {
    killer: [0.72, 1.55, 45, 18, 3, 1.0],
    ghost: [1.12, 1.25, 28, 65, 16, 1.3],
    demon: [0.48, 2.35, 85, 70, 30, 0.4],
    robot: [1.10, 1.25, 15, 80, 85, 0.2],
    deep: [0.55, 1.80, 70, 20, 10, 0.0],
    whisper: [1.48, 0.42, 65, 75, 90, 1.0]
};

document.querySelectorAll("[data-p]").forEach(button => {

    button.addEventListener("click", () => {

        const name = button.dataset.p;
        const p = presets[name];

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

// Если ползунки изменились
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

// Создаём индикаторы, если есть контейнер
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

console.log("GHOST FACE AUDIO loaded");
