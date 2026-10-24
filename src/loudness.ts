/**
 * EBU R128-style integrated loudness, measured in the webview. Used on Android, where
 * there's no ffmpeg to measure downloads natively (desktop measures with ffmpeg).
 */
export async function measureLoudness(url: string): Promise<{ lufs: number; peak: number } | null> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const decoder = new OfflineAudioContext(1, 1, 48000);
  const audio = await decoder.decodeAudioData(bytes);
  const { numberOfChannels: channels, length, sampleRate: rate } = audio;
  if (length < rate) return null;

  // K-weighting: high shelf (+4 dB above ~1.7 kHz) then a high-pass at ~38 Hz
  const ctx = new OfflineAudioContext(channels, length, rate);
  const src = ctx.createBufferSource();
  src.buffer = audio;
  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 1681;
  shelf.gain.value = 4;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 38;
  hp.Q.value = 0.5;
  src.connect(shelf).connect(hp).connect(ctx.destination);
  src.start();
  const k = await ctx.startRendering();

  // Mean square of 400 ms blocks with 75 % overlap
  const block = Math.round(0.4 * rate);
  const step = Math.round(0.1 * rate);
  const data = Array.from({ length: channels }, (_, c) => k.getChannelData(c));
  const energies: number[] = [];
  for (let start = 0; start + block <= length; start += step) {
    let z = 0;
    for (const ch of data) {
      let sum = 0;
      for (let i = start; i < start + block; i++) sum += ch[i] * ch[i];
      z += sum / block;
    }
    energies.push(z);
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const abs = energies.filter((z) => z > 0 && lufs(z) > -70);
  if (!abs.length) return null;
  const threshold = lufs(mean(abs)) - 10;
  const gated = abs.filter((z) => lufs(z) > threshold);

  let peak = 0;
  for (let c = 0; c < channels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  }
  return { lufs: lufs(mean(gated)), peak: 20 * Math.log10(peak || 1e-9) };
}
