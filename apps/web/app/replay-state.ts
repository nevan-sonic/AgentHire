export const stages = [
  "Job created", "Workers discovered", "Bids received", "PoCP chooses TEST",
  "Capability-test payment verified", "Economy test fails", "Reliability updates",
  "Balanced selected", "Final-hire payment verified", "Balanced task completed", "HCS audit verified",
] as const;

export const initialReplay = { step: 0, playing: false };
type Action = "start" | "play" | "pause" | "reset" | "step" | "tick";

export function replayReducer(state: typeof initialReplay, action: Action): typeof initialReplay {
  const last = stages.length - 1;
  switch (action) {
    case "start": return { step: 0, playing: true };
    case "play": return { step: state.step === last ? 0 : state.step, playing: true };
    case "pause": return { ...state, playing: false };
    case "reset": return initialReplay;
    case "step":
    case "tick": {
      if (action === "tick" && !state.playing) return state;
      const step = Math.min(state.step + 1, last);
      return { step, playing: action === "tick" && step < last };
    }
  }
}
