let ctx = null;
let stream = null;
let source = null;
let inputGain = null;
let master = null;
let analyser = null;
let bass = null;
let low = null;
let running = false;
let raf = 0;

const $ = id => document.getElementById(id);

const ids = ["pitch", "gain", "dark", "dist", "echo", "delay"];

function labels() {
  $("pitchV").textContent = (+$("pitch").value).toFixed(2) + "×";
  $("gainV").textContent = (+$("gain").value).toFixed(1) + "×";
  $("darkV").textContent = $("dark").value + "%";
  $("distV").textContent = $("dist").value + "%";
  $("echoV").textContent = "OFF";
  $("delayV").textContent = "OFF";
}

ids.forEach(id => {
  const el = $(id);
  if (el) {
    el.addEventListener("input", () => {
      labels();
      apply();
    });
  }
});

labels();

function apply() {
  if (!ctx) return;

  // Громкость входа
  inputGain.gain.setTargetAtTime(
    +$("gain").value * 0.7,
    ctx.currentTime,
    0.02
  );

  // МЯГКИЙ НИЗ
  low.gain.setTargetAtTime(
    5,
    ctx.currentTime,
    0.03
  );

  // ОЧЕНЬ ГЛУБОКИЙ БАС
  bass.gain.setTargetAtTime(
    16,
    ctx.currentTime,
    0.04
  );

  // Никакого эха и задержки
  master.gain.setTargetAtTime(
    0.18,
    ctx.currentTime,
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

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    await ctx.resume();

    source = ctx.createMediaStreamSource(stream);

    inputGain = ctx.createGain();
    low = ctx.createBiquadFilter();
    bass = ctx.createBiquadFilter();
    master = ctx.createGain();
    analyser = ctx.createAnalyser();

    analyser.fftSize = 512;

    // Срезаем лишний верх
    low.type = "lowshelf";
    low.frequency.value = 180;
    low.gain.value = 5;

    // Ghostface BASS
    bass.type = "peaking";
    bass.frequency.value = 75;
    bass.Q.value = 1.1;
    bass.gain.value = 16;

    // Без задержки
    source.connect(inputGain);
    inputGain.connect(low);
    low.connect(bass);
    bass.connect(master);

    master.connect(analyser);
    analyser.connect(ctx.destination);

    running = true;

    $("power").textContent = "⏹ STOP VOICE";
    $("led").parentElement.classList.add("on");
    $("state").textContent = "LIVE";

    apply();
    draw();

  } catch (e) {
    alert(
      "Микрофон не открылся. Разреши микрофон браузеру и используй HTTPS."
    );

    console.error(e);

    if (ctx) ctx.close();
  }
}

function stop() {
  running = false;

  cancelAnimationFrame(raf);

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }

  if (ctx) {
    ctx.close();
  }

  ctx = null;
  stream = null;
  source = null;
  inputGain = null;
  master = null;
  analyser = null;
  bass = null;
  low = null;

  $("power").textContent = "🎙 START VOICE";
  $("led").parentElement.classList.remove("on");
  $("state").textContent = "OFFLINE";
  $("levelText").textContent = "000";

  document.querySelectorAll(".bar").forEach(
    bar => bar.style.height = "5%"
  );
}

function draw() {
  if (!running) return;

  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);

  let sum = 0;

  for (const value of data) {
    const x = (value - 128) / 128;
    sum += x * x;
  }

  const rms = Math.sqrt(sum / data.length);
  const level = Math.min(100, Math.round(rms * 180));

  $("levelText").textContent =
    String(level).padStart(3, "0");

  const bars = [
    ...document.querySelectorAll(".bar")
  ];

  bars.forEach((bar, i) => {
    const value =
      Math.abs(data[(i * 4) % data.length] - 128) / 128;

    bar.style.height =
      Math.max(5, Math.min(100, value * 220)) + "%";
  });

  raf = requestAnimationFrame(draw);
}

$("power").addEventListener("click", start);

// Пресеты — без эха и задержки
const presets = {
  killer: [.72, 1.7, 55, 0, 0, 0],
  ghost: [.90, 1.5, 25, 0, 0, 0],
  demon: [.65, 2.0, 70, 0, 0, 0],
  robot: [1, 1.25, 15, 0, 0, 0],
  deep: [.55, 1.8, 80, 0, 0, 0],
  whisper: [1.1, 1.3, 65, 0, 0, 0]
};

document.querySelectorAll("[data-p]").forEach(button => {
  button.onclick = () => {
    const p = presets[button.dataset.p];

    $("pitch").value = p[0];
    $("gain").value = p[1];
    $("dark").value = p[2];
    $("dist").value = 0;
    $("echo").value = 0;
    $("delay").value = 0;

    labels();
    apply();
  };
});

const bars = $("bars");

for (let i = 0; i < 48; i++) {
  const bar = document.createElement("div");
  bar.className = "bar";
  bars.appendChild(bar);
  }
