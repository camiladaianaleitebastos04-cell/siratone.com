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

// Emulador de Clipping Severo de Estado Sólido (Padrão de amplificação EOWS)
function generateAmplifierCurve(amount) {
    let k = amount, n = 44100, curve = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
        let x = (i * 2) / n - 1;
        // Achata drasticamente a onda dente de serra para soar como onda quadrada distorcida
        curve[i] = ((3 + k) * x) / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

// --- ENGINE EXCLUSIVA: CHIMES ORIGINAL DA SÉRIE EOWS (FEDERAL SIGNAL) ---
function triggerChimes(element) {
    initContext();
    silence();
    
    element.classList.add('active');
    document.getElementById('lbl-mode').innerText = "EOWS CHIMES";

    // Frequências relativas exatas do circuito gerador de tom analógico da FS
    const westminsterNotes = [1.0, 1.25, 1.122, 0.75, 1.0, 1.122, 1.25, 1.0]; 
    // O compasso clássico da EOWS: notas longas e espaçadas que dão tempo de ouvir o eco
    const noteDurations = [1.3, 1.3, 1.3, 1.8, 1.3, 1.3, 1.3, 2.4];
    
    let basePitch = parseInt(document.getElementById('cfg-pitch').value);
    let timeline = ctx.currentTime + 0.05;

    for (let i = 0; i < westminsterNotes.length; i++) {
        let targetFreq = basePitch * westminsterNotes[i];
        let duration = noteDurations[i];

        // Componentes para recriar a arquitetura interna do oscilador ESC
        let oscMain = ctx.createOscillator();
        let oscSub = ctx.createOscillator();  // Onda de reforço harmônico
        let lfoMod = ctx.createOscillator();  // O famoso "vibrato instável" da EOWS
        let lfoGain = ctx.createGain();
        
        let filterHP = ctx.createBiquadFilter();
        let hornResonance = ctx.createBiquadFilter();
        let ampClipping = ctx.createWaveShaper();
        let ampGain = ctx.createGain();

        // Configuração purista: Dente de serra agressiva
        oscMain.type = 'sawtooth';
        oscSub.type = 'sawtooth';
        
        oscMain.frequency.setValueAtTime(targetFreq, timeline);
        // Ajustado em 1.5x (Intervalo de Quinta) para dar aquela ressonância metálica "oca" das EOWS de metal
        oscSub.frequency.setValueAtTime(targetFreq * 1.5, timeline); 

        // Modulação de fase instável analógica de 5.2Hz (O balanço clássico do som das EOWS)
        lfoMod.frequency.setValueAtTime(5.2, timeline);
        lfoGain.gain.setValueAtTime(3.5, timeline); // Modulação profunda para dar o efeito de batimento
        
        lfoMod.connect(lfoGain);
        lfoGain.connect(oscMain.frequency);
        lfoGain.connect(oscSub.frequency);

        // Filtro passa-alta agressivo: os drivers das EOWS cortavam tudo abaixo de 300Hz para não queimar
        filterHP.type = 'highpass';
        filterHP.frequency.setValueAtTime(310, timeline);

        // Pico de ressonância simulando o formato da corneta retangular (estilo EOWS 115 / Thunderbolt)
        hornResonance.type = 'peaking';
        hornResonance.frequency.setValueAtTime(targetFreq * 1.2, timeline);
        hornResonance.Q.setValueAtTime(5.0);
        let resIntensity = document.getElementById('cfg-horn').value;
        hornResonance.gain.setValueAtTime(resIntensity * 0.22, timeline);

        // Clipping pesado do amplificador
        ampClipping.curve = generateAmplifierCurve(45); // Saturação aumentada para o padrão EOWS
        ampClipping.oversample = '4x';

        // Envoltória de Volume EOWS: Ataque seco de relé elétrico e decaimento linear-exponencial
        ampGain.gain.setValueAtTime(0, timeline);
        ampGain.gain.linearRampToValueAtTime(0.60, timeline + 0.02); // Clique rápido do início do tom
        ampGain.gain.exponentialRampToValueAtTime(0.001, timeline + duration);

        // Conectando os componentes
        oscMain.connect(filterHP);
        oscSub.connect(filterHP);
        filterHP.connect(hornResonance);
        hornResonance.connect(ampClipping);
        ampClipping.connect(ampGain);
        ampGain.connect(ctx.destination);

        oscMain.start(timeline);
        oscSub.start(timeline);
        lfoMod.start(timeline);
        
        oscMain.stop(timeline + duration);
        oscSub.stop(timeline + duration);
        lfoMod.stop(timeline + duration);

        activeNodes.push(oscMain, oscSub, lfoMod, ampGain);

        // Atualiza a frequência no display em tempo real
        let triggerDelay = (timeline - ctx.currentTime) * 1000;
        setTimeout(() => {
            if (document.getElementById('lbl-mode').innerText === "EOWS CHIMES") {
                document.getElementById('lbl-freq').innerText = Math.round(targetFreq) + " Hz";
            }
        }, triggerDelay);

        // Intervalo de tempo entre as batidas do carrilhão
        timeline += (duration * 0.78); 
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

}

