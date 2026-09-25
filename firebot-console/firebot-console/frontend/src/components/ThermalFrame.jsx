import React, { useEffect, useRef } from "react";
import { THERM_ROWS, THERM_COLS } from "../lib/simEngine.js";

function colorFor(t) {
  // 22C..70C mapped dark-blue -> cyan -> amber -> red, matching the console's telemetry/warn/alarm hues
  const stops = [
    [0.0, [15, 23, 32]], [0.35, [63, 167, 214]], [0.65, [245, 166, 35]], [1.0, [232, 67, 47]],
  ];
  const v = Math.max(0, Math.min(1, (t - 22) / (70 - 22)));
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const f = (v - t0) / (t1 - t0 || 1);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }
  return stops[stops.length - 1][1];
}

export default function ThermalFrame({ frame, width = 220, height = 165 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    canvas.width = THERM_COLS; canvas.height = THERM_ROWS;
    const img = ctx.createImageData(THERM_COLS, THERM_ROWS);
    if (frame) {
      for (let i = 0; i < frame.length; i++) {
        const [r, g, b] = colorFor(frame[i]);
        img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [frame]);
  return (
    <canvas
      ref={ref}
      style={{ width, height, imageRendering: "pixelated" }}
      className="border border-line"
    />
  );
}
