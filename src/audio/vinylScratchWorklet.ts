/**
 * AudioWorklet processor for continuous, sample-accurate turntable vinyl scratching.
 * Uses 4-point cubic Catmull-Rom interpolation, critically-damped hand-tracking physics,
 * authentic direct-drive motor spin-up / backspin inertia, and DC blocking so scratches
 * glide smoothly through zero velocity in both directions with zero clicks or stuttering.
 */

const VINYL_SCRATCH_WORKLET_SOURCE = `
class VinylScratchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = null;
    this.right = null;
    this.bufLength = 0;
    this.bufSampleRate = sampleRate;
    this.durationSec = 0;

    // 'idle' | 'touch' | 'release' | 'handoff'
    this.mode = 'idle';
    this.posSec = 0;
    this.targetPosSec = 0;
    this.velSec = 0;
    this.wasPlaying = false;
    this.targetPlaybackRate = 1;
    this.handoffSamplesLeft = 0;

    // Smooth gain envelope & DC blocker state
    this.velGain = 0;
    this.dcInL = 0;
    this.dcOutL = 0;
    this.dcInR = 0;
    this.dcOutR = 0;

    // Gentle high-speed anti-alias lowpass state
    this.lpL = 0;
    this.lpR = 0;

    this.reportCounter = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg || !msg.type) return;

      if (msg.type === 'loadBuffer') {
        this.left = msg.left;
        this.right = msg.right || msg.left;
        this.bufLength = this.left ? this.left.length : 0;
        this.bufSampleRate = msg.sampleRate || sampleRate;
        this.durationSec = this.bufLength > 0 ? this.bufLength / this.bufSampleRate : 0;
        return;
      }

      if (msg.type === 'touchStart') {
        const maxPos = Math.max(0, this.durationSec - 0.01);
        const startPos = Math.min(maxPos, Math.max(0, msg.posSec || 0));
        this.posSec = startPos;
        this.targetPosSec = startPos;
        this.velSec = typeof msg.initialVel === 'number' ? msg.initialVel : 0;
        this.wasPlaying = Boolean(msg.wasPlaying);
        this.targetPlaybackRate = msg.targetPlaybackRate || 1;
        this.mode = 'touch';
        this.handoffSamplesLeft = 0;
        this.velGain = Math.abs(this.velSec) > 0.05 ? 1 : 0;
        return;
      }

      if (msg.type === 'touchMove') {
        if (this.mode !== 'touch') return;
        const maxPos = Math.max(0, this.durationSec - 0.01);
        this.targetPosSec = Math.min(maxPos, Math.max(0, msg.targetPosSec || 0));
        return;
      }

      if (msg.type === 'touchEnd') {
        if (this.mode !== 'touch') return;
        this.wasPlaying = Boolean(msg.wasPlaying);
        this.targetPlaybackRate = msg.targetPlaybackRate || 1;
        this.mode = 'release';
        return;
      }

      if (msg.type === 'cancel') {
        this.mode = 'idle';
        this.velSec = 0;
        this.velGain = 0;
        this.handoffSamplesLeft = 0;
      }
    };
  }

  sampleCubic(ch, idx) {
    const len = this.bufLength;
    if (len < 4) return 0;
    let i1 = Math.floor(idx);
    if (i1 < 0) i1 = 0;
    if (i1 >= len - 1) i1 = len - 2;
    const t = idx - i1;
    const i0 = i1 > 0 ? i1 - 1 : 0;
    const i2 = i1 + 1 < len ? i1 + 1 : len - 1;
    const i3 = i1 + 2 < len ? i1 + 2 : len - 1;

    const y0 = ch[i0];
    const y1 = ch[i1];
    const y2 = ch[i2];
    const y3 = ch[i3];

    const c0 = y1;
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + c0;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outL = output[0];
    const outR = output[1] || outL;
    const blockLen = outL.length;

    if (this.mode === 'idle' || !this.left || this.bufLength < 4) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }

    const dt = 1 / sampleRate;
    const maxPosSec = Math.max(0, this.durationSec - 0.01);
    const omega = 130; // snappy ~7.7ms critically-damped vinyl tracking
    const zeta = 0.96;
    const omegaSq = omega * omega;
    const twoZetaOmega = 2 * zeta * omega;

    for (let i = 0; i < blockLen; i++) {
      if (this.mode === 'touch') {
        const err = this.targetPosSec - this.posSec;
        const accel = omegaSq * err - twoZetaOmega * this.velSec;
        this.velSec += accel * dt;
        if (this.velSec > 6.5) this.velSec = 6.5;
        if (this.velSec < -6.5) this.velSec = -6.5;
        this.posSec += this.velSec * dt;
      } else if (this.mode === 'release') {
        if (this.wasPlaying) {
          // Backspin coasts under slipmat friction; normal release catches motor torque crisply
          const tauRate = this.velSec < -0.75 ? 4.8 : 34.0;
          const blend = 1 - Math.exp(-tauRate * dt);
          this.velSec += (this.targetPlaybackRate - this.velSec) * blend;
          this.posSec += this.velSec * dt;

          if (Math.abs(this.velSec - this.targetPlaybackRate) < 0.025) {
            this.velSec = this.targetPlaybackRate;
            this.mode = 'handoff';
            // Keep outputting smoothly for ~25ms while main thread crossfades to BufferSource
            this.handoffSamplesLeft = Math.floor(sampleRate * 0.025);
            this.port.postMessage({
              type: 'releaseComplete',
              posSec: Math.min(maxPosSec, Math.max(0, this.posSec)),
            });
          }
        } else {
          // Paused deck: natural slipmat friction decay to a clean stop
          this.velSec *= Math.exp(-15.0 * dt);
          this.posSec += this.velSec * dt;
          if (Math.abs(this.velSec) < 0.015) {
            this.velSec = 0;
            this.mode = 'idle';
            this.port.postMessage({
              type: 'releaseComplete',
              posSec: Math.min(maxPosSec, Math.max(0, this.posSec)),
            });
          }
        }
      } else if (this.mode === 'handoff') {
        this.posSec += this.targetPlaybackRate * dt;
        this.handoffSamplesLeft--;
        if (this.handoffSamplesLeft <= 0) {
          this.mode = 'idle';
          this.velSec = 0;
        }
      }

      if (this.posSec < 0) {
        this.posSec = 0;
        if (this.velSec < 0) this.velSec = 0;
      } else if (this.posSec > maxPosSec) {
        this.posSec = maxPosSec;
        if (this.velSec > 0) this.velSec = 0;
      }

      const absVel = Math.abs(this.velSec);
      const targetGain =
        absVel < 0.004 ? 0 : absVel >= 0.065 ? 1 : (absVel - 0.004) / (0.065 - 0.004);
      this.velGain += (targetGain - this.velGain) * 0.035;

      const sampleIdx = this.posSec * this.bufSampleRate;
      let sL = this.sampleCubic(this.left, sampleIdx);
      let sR = this.right !== this.left ? this.sampleCubic(this.right, sampleIdx) : sL;

      // Subtle velocity-adaptive smoothing only on ultra-fast scratches to prevent harsh aliasing
      if (absVel > 2.2) {
        const alpha = Math.max(0.32, 1.0 - (absVel - 2.2) * 0.14);
        this.lpL += (sL - this.lpL) * alpha;
        this.lpR += (sR - this.lpR) * alpha;
        sL = this.lpL;
        sR = this.lpR;
      } else {
        this.lpL = sL;
        this.lpR = sR;
      }

      // Apply smooth stop envelope
      sL *= this.velGain;
      sR *= this.velGain;

      // Gentle DC blocker (~12Hz) eliminates zero-velocity DC pops when stopping mid-waveform
      const dcL = sL - this.dcInL + 0.9975 * this.dcOutL;
      this.dcInL = sL;
      this.dcOutL = dcL;

      const dcR = sR - this.dcInR + 0.9975 * this.dcOutR;
      this.dcInR = sR;
      this.dcOutR = dcR;

      outL[i] = dcL;
      if (outR !== outL) outR[i] = dcR;
    }

    this.reportCounter += blockLen;
    if (this.reportCounter >= 1024) {
      this.reportCounter = 0;
      this.port.postMessage({
        type: 'pos',
        posSec: this.posSec,
        velSec: this.velSec,
      });
    }

    return true;
  }
}

registerProcessor('vinyl-scratch-processor', VinylScratchProcessor);
`;

let cachedWorkletUrl: string | null = null;

export function getVinylScratchWorkletUrl(): string {
  if (!cachedWorkletUrl) {
    const blob = new Blob([VINYL_SCRATCH_WORKLET_SOURCE], {
      type: 'application/javascript',
    });
    cachedWorkletUrl = URL.createObjectURL(blob);
  }
  return cachedWorkletUrl;
}
