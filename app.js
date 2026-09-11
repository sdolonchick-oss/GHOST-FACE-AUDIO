let ctx = null,
  stream = null,
  source = null,
  inputGain = null,
  master = null,
  analyser = null,
  delayNode = null,
  feedback = null,
  distortion = null,
  low = null,
  bass = null,
  high = null,
  running = false,
  raf = 0;

const $ = x => document.getElementById(x);

const ids = [
  "pitch",
  "gain",
  "dark",
  "dist",
  "echo",
  "delay",
  "volume"
];

function labels() {
  $("pitchV").textContent = (+$("pitch").value).toFixed(2) + "×";
  $("gainV").textContent = (+$("gain").value).toFixed(1) + "×";
  $("darkV").textContent = $("dark").value + "%";
  $("distV").textContent = $("dist").value + "%";
  $("echoV").textContent = $("echo").value + "%";
  $("delayV").textContent = (+$("delay").value).toFixed(2) + "s";

  if ($("volume") && $("volumeV")) {
    $("volumeV").textContent = $("volume").value + "%";
  }
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

function makeCurve(amount) {
  const n = 44100;
  const c = new Float32Array(n);
  const k = 1 + amount * 25;

  for (let i = 0; i < n; i++) {
    const x = i * 2 / n - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }

  return c;
}

function apply() {
  if (!ctx) return;

  // Основное усиление
  inputGain.gain.setTargetAtTime(
    +$("gain").value,
    ctx.currentTime,
    0.02
  );

  // Очень глубокий низ
  low.gain.setTargetAtTime(
    -20 * (+$("dark").value / 100),
    ctx.currentTime,
    0.03
  );

  // МОЩНЫЙ BASS
  bass.gain.setTargetAtTime(
    18 + (+$("dark").value * 0.12),
    ctx.currentTime,
    0.04
  );

  // Верхние частоты
  high.gain.setTargetAtTime(
    (+$("pitch").value - 1) * 18,
    ctx.currentTime,
    0.03
  );

  distortion.curve = makeCurve(+$("dist").value / 100);

  delayNode.delayTime.setTargetAtTime(
    +$("delay").value,
    ctx.currentTime,
    0.03
  );

  feedback.gain.setTargetAtTime(
    (+$("echo").value / 100) * 0.35,
    ctx.currentTime,
    0.03
  );

  // Громкость выхода
  if ($("volume")) {
    const v = +$("volume").value / 100;
    master.gain.setTargetAtTime(
      Math.min(0.35, v * 0.35),
      ctx.currentTime,
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
    master = ctx.createGain();
    analyser = ctx.createAnalyser();

    analyser.fftSize = 1024;

    // Низкая полка
    low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 120;
    low.gain.value = 0;

    // ОТДЕЛЬНЫЙ СУПЕР-БАС
    bass = ctx.createBiquadFilter();
    bass.type = "peaking";
    bass.frequency.value = 85;
    bass.Q.value = 0.85;
    bass.gain.value = 20;

    // Верх
    high = ctx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 2200;

    distortion = ctx.createWaveShaper();
    distortion.oversample = "4x";

    delayNode = ctx.createDelay(5);
    feedback = ctx.createGain();

    // Начальная громкость
    master.gain.value = 0.10;

    // Цепочка:
    // MIC → GAIN → LOW → BASS → HIGH → DISTORTION → DELAY → MASTER
    source.connect(inputGain);
    inputGain.connect(low);
    low.connect(bass);
    bass.connect(high);
    high.connect(distortion);

    distortion.connect(delayNode);

    delayNode.connect(master);

    // Эхо
    delayNode.connect(feedback);
    feedback.connect(delayNode);

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

    if (ctx) {
      ctx.close();
    }
  }
}

function stop() {
  running = false;

  cancelAnimationFrame(raf);

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }

  if (ctx) {
    ctx.close();
  }

  ctx =
    stream =
    source =
    inputGain =
    master =
    analyser =
    delayNode =
    feedback =
    distortion =
    low =
    bass =
    high =
      null;

  $("power").textContent = "🎙 START VOICE";
  $("led").parentElement.classList.remove("on");
  $("state").textContent = "OFFLINE";

  $("levelText").textContent = "000";

  document.querySelectorAll(".bar").forEach(
    b => b.style.height = "5%"
  );
}

function draw() {
  if (!running) return;

  const data = new Uint8Array(analyser.fftSize);

  analyser.getByteTimeDomainData(data);

  let sum = 0;

  for (const v of data) {
    const x = (v - 128) / 128;
    sum += x * x;
  }

  const rms = Math.sqrt(sum / data.length);

  const level = Math.min(
    100,
    Math.round(rms * 180)
  );

  $("levelText").textContent =
    String(level).padStart(3, "0");

  const bars = [
    ...document.querySelectorAll(".bar")
  ];

  bars.forEach((b, i) => {
    const v =
      Math.abs(
        data[(i * 8) % data.length] - 128
      ) / 128;

    b.style.height =
      Math.max(
        5,
        Math.min(100, v * 220)
      ) + "%";
  });

  raf = requestAnimationFrame(draw);
}

$("power").addEventListener("click", start);

const presets = {
  killer: [.72, 1.7, 55, 45, 18, .03],
  ghost: [1.12, 1.5, 25, 28, 65, .16],
  demon: [.48, 2.3, 85, 70, 30, .04],
  robot: [1, 1.25, 15, 80, 85, .02],
  deep: [.55, 1.8, 70, 20, 10, 0],
  whisper: [1.48, 4.2, 65, 75, 90, .10]
};

document.querySelectorAll("[data-p]").forEach(b => {
  b.onclick = () => {
    const p = presets[b.dataset.p];

    [
      $("pitch").value,
      $("gain").value,
      $("dark").value,
      $("dist").value,
      $("echo").value,
      $("delay").value
    ] = p;

    labels();
    apply();
  };
});

const bars = $("bars");

for (let i = 0; i < 48; i++) {
  const b = document.createElement("div");
  b.className = "bar";
  bars.appendChild(b);
}
