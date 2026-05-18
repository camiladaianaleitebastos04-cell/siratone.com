let ctx = null;
let activeNodes = [];
let loopTimer = null;
let chimeTimeout = null;

// Inicializa os seletores após o carregamento da página
document.addEventListener("DOMContentLoaded", () => {
    // Eventos dos botões de disparo
    document.getElementById("btn-chimes").addEventListener("click", function() { triggerChimes(this); });
    document.getElementById("btn-wail").addEventListener("click", function() { triggerSiren('wail', this); });
    document.getElementById("btn-yelp").addEventListener("click", function() { triggerSiren('yelp', this); });
    document.getElementById("btn-steady").addEventListener("click", function() { triggerSiren('steady', this); });
    document.getElementById("btn-cancel").addEventListener("click", function() { silence(this); });

    // Eventos para atualização visual dos Trimpots
    document.getElementById('cfg-pitch').addEventListener('input', (e) => {
        document.getElementById('v-pitch').innerText = e.target.value + " Hz";
    });
    document.getElementById('cfg-horn').addEventListener('input', (e) => {
        document.getElementById('v-horn').innerText = e.target.value + "%";
    });
});

function initContext() {
    if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// Emulador de Clipping Assimétrico do Amplificador de Potência
function generateAmplifierCurve(amount) {
    let k = amount, n = 44100, curve = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
        let x = (i * 2) / n - 1;
        curve[i] = ((3 + k) * x) / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

// --- ENGINE REESCRITA DO WESTMINSTER CHIMES (SAWTOOTH) ---
function triggerChimes(element) {
    initContext();
    silence();
    
    element.classList.add('active');
    document.getElementById('lbl-mode').innerText = "WESTMINSTER";

    const westminsterNotes = [1.0, 1.25, 1.122, 0.75, 1.0, 1.122, 1.25, 1.0]; 
    const noteDurations = [1.1, 1.1, 1.1, 1.6, 1.1, 1.1, 1.1, 2.0];
    
    let basePitch = parseInt(document.getElementById('cfg-pitch').value);
    let timeline = ctx.currentTime + 0.05;

    for (let i = 0; i < westminsterNotes.length; i++) {
        let targetFreq = basePitch * westminsterNotes[i];
        let duration = noteDurations[i];

        let osc = ctx.createOscillator();
        let subOsc = ctx.createOscillator(); 
        let lfo = ctx.createOscillator(); 
        let lfoGain = ctx.createGain();
        
        let filter = ctx.createBiquadFilter();
        let hornPeak = ctx.createBiquadFilter();
        let shaper = ctx.createWaveShaper();
        let gainNode = ctx.createGain();

        osc.type = 'sawtooth';
        subOsc.type = 'sawtooth';
        
        osc.frequency.setValueAtTime(targetFreq, timeline);
        subOsc.frequency.setValueAtTime(targetFreq * 0.5, timeline); 

        lfo.frequency.setValueAtTime(4.5, timeline);
        lfoGain.gain.setValueAtTime(1.8, timeline);
        
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfoGain.connect(subOsc.frequency);

        filter.type = 'highpass';
        filter.frequency.setValueAtTime(190, timeline);

        hornPeak.type = 'peaking';
        hornPeak.frequency.setValueAtTime(targetFreq, timeline);
        hornPeak.Q.setValueAtTime(4.5, timeline);
        let resIntensity = document.getElementById('cfg-horn').value;
        hornPeak.gain.setValueAtTime(resIntensity * 0.18, timeline);

        shaper.curve = generateAmplifierCurve(32);
        shaper.oversample = '4x';

        gainNode.gain.setValueAtTime(0, timeline);
        gainNode.gain.linearRampToValueAtTime(0.55, timeline + 0.015);
        gainNode.gain.exponentialRampToValueAtTime(0.001, timeline + duration);

        let dynamicFilter = ctx.createBiquadFilter();
        dynamicFilter.type = 'lowpass';
        dynamicFilter.frequency.setValueAtTime(targetFreq * 3, timeline);
        dynamicFilter.frequency.exponentialRampToValueAtTime(targetFreq * 0.8, timeline + duration);

        osc.connect(dynamicFilter);
        subOsc.connect(dynamicFilter);
        dynamicFilter.connect(filter);
        filter.connect(hornPeak);
        hornPeak.connect(shaper);
        shaper.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(timeline);
        subOsc.start(timeline);
        lfo.start(timeline);
        
        osc.stop(timeline + duration);
        subOsc.stop(timeline + duration);
        lfo.stop(timeline + duration);

        activeNodes.push(osc, subOsc, lfo, gainNode);

        let triggerDelay = (timeline - ctx.currentTime) * 1000;
        setTimeout(() => {
            if (document.getElementById('lbl-mode').innerText === "WESTMINSTER") {
                document.getElementById('lbl-freq').innerText = Math.round(targetFreq) + " Hz";
            }
        }, triggerDelay);

        timeline += (duration * 0.75); 
    }

    chimeTimeout = setTimeout(() => {
        silence();
    }, (timeline - ctx.currentTime + 0.5) * 1000);
}

// --- ENGINE DE SINAIS DE EMERGÊNCIA (WAIL, YELP, STEADY) ---
function triggerSiren(mode, element) {
    initContext();
    silence();

    element.classList.add('active');
    document.getElementById('lbl-mode').innerText = mode.toUpperCase();

    let osc = ctx.createOscillator();
    osc.type = 'sawtooth';

    let filterNode = ctx.createBiquadFilter();
    filterNode.type = 'highpass';
    filterNode.frequency.setValueAtTime(280, ctx.currentTime);

    let hornResonance = ctx.createBiquadFilter();
    hornResonance.type = 'peaking';
    let resIntensity = document.getElementById('cfg-horn').value;
    hornResonance.frequency.setValueAtTime(460, ctx.currentTime);
    hornResonance.Q.setValueAtTime(3.8, ctx.currentTime);
    hornResonance.gain.setValueAtTime(resIntensity * 0.16, ctx.currentTime);

    let shaperNode = ctx.createWaveShaper();
    shaperNode.curve = generateAmplifierCurve(28);
    shaperNode.oversample = '4x';

    let gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.65, ctx.currentTime + 0.05);

    osc.connect(filterNode);
    filterNode.connect(hornResonance);
    hornResonance.connect(shaperNode);
    shaperNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    let centerFreq = parseInt(document.getElementById('cfg-pitch').value);
    osc.frequency.setValueAtTime(centerFreq, ctx.currentTime);
    osc.start();

    activeNodes.push(osc, gainNode);
    let startTime = ctx.currentTime;

    if (mode === 'wail') {
        loopTimer = setInterval(() => {
            let elapsed = ctx.currentTime - startTime;
            let cycle = elapsed % 6.2;
            let currentFreq;
            if (cycle < 3.8) {
                currentFreq = centerFreq - 120 + (230 * Math.pow(cycle / 3.8, 1.4));
            } else {
                currentFreq = centerFreq + 110 - (230 * Math.pow((cycle - 3.8) / 2.4, 0.85));
            }
            osc.frequency.setValueAtTime(currentFreq, ctx.currentTime);
            document.getElementById('lbl-freq').innerText = Math.round(currentFreq) + " Hz";
        }, 20);
    } else if (mode === 'yelp') {
        loopTimer = setInterval(() => {
            let elapsed = ctx.currentTime - startTime;
            let cycle = elapsed % 0.6;
            let currentFreq = cycle < 0.35 ? (centerFreq - 100) + (200 * (cycle / 0.35)) : (centerFreq + 100) - (200 * ((cycle - 0.35) / 0.25));
            osc.frequency.setValueAtTime(currentFreq, ctx.currentTime);
            document.getElementById('lbl-freq').innerText = Math.round(currentFreq) + " Hz";
        }, 15);
    } else if (mode === 'steady') {
        loopTimer = setInterval(() => {
            let drift = Math.sin(ctx.currentTime * 4.8) * 1.3;
            osc.frequency.setValueAtTime(centerFreq + drift, ctx.currentTime);
            document.getElementById('lbl-freq').innerText = Math.round(centerFreq + drift) + " Hz";
        }, 50);
    }
}

// --- RESET E CORTE ELÉTRICO ---
function silence(element) {
    if (loopTimer) clearInterval(loopTimer);
    if (chimeTimeout) clearTimeout(chimeTimeout);
    
    if (element && element.classList.contains('abort-command')) {
        element.classList.add('active');
        setTimeout(() => element.classList.remove('active'), 200);
    }

    activeNodes.forEach(node => {
        try {
            if (node instanceof AudioGainNode || node.gain) {
                node.gain.setValueAtTime(node.gain.value, ctx.currentTime);
                node.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
            } else {
                node.stop(ctx.currentTime + 0.2);
            }
        } catch(e) {}
    });
    
    activeNodes = [];
    document.querySelectorAll('.interface-matrix button').forEach(b => {
        if(!b.classList.contains('abort-command')) b.classList.remove('active');
    });
    document.getElementById('lbl-mode').innerText = "SYSTEM READY";
    document.getElementById('lbl-freq').innerText = "0 Hz";
}

