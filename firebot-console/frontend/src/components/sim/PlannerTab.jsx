import React from "react";
import Ring from "../Ring.jsx";
import { PanelHeader } from "../TelemetryGauges.jsx";

function Stat({ label, value, unit, alarm }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] text-muted mb-1.5">{label}</div>
      <span className={`data text-[20px] leading-none ${alarm ? "text-warn" : "text-ink"}`}>{value}</span>
      {unit && <span className="text-[11px] text-faint ml-1">{unit}</span>}
    </div>
  );
}

export default function PlannerTab({ t }) {
  const { plans, failures, length } = t.planStats;
  const total = plans + failures;
  const straight = t.goal ? Math.hypot(t.goal[0] - t.robot.x, t.goal[1] - t.robot.y) : null;
  const headline = !t.goal ? "No route right now. The robot is exploring or holding."
    : t.path ? `Heading to ${t.goalKind}: ${t.path.length} waypoints, ${length.toFixed(1)} m to go.`
    : `Wants to reach ${t.goalKind} but has no route yet. It will retry.`;
  return (
    <div>
      <div className="px-4 py-4 text-[14px] leading-snug">{headline}</div>
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Stat label="Straight-line distance" value={straight != null ? straight.toFixed(1) : "—"} unit="m" />
        <Stat label="Search tree size" value={t.tree.length} unit="nodes" />
      </div>
      <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
        <Stat label="Routes found" value={plans} />
        <Stat label="Routes failed" value={failures} alarm={failures > 0} />
      </div>
      <PanelHeader label="Planning reliability" />
      <div className="border-t border-line py-4 flex items-center justify-center gap-6">
        <Ring label="Success rate" value={total ? plans / total : 0} good={failures === 0} low={total > 0 && plans / total < 0.5} />
        <p className="text-[12px] text-muted max-w-[150px] leading-relaxed">{total ? `${plans} of ${total} plans this scenario found a collision-free route.` : "No plans attempted yet."}</p>
      </div>
      <details className="border-t border-line px-4 py-3 text-[12px] text-muted">
        <summary className="cursor-pointer text-ink">How this planner works</summary>
        <p className="mt-2 leading-relaxed">
          Informed RRT* grows a tree of random collision-free points, rewires it toward shorter routes, then shortcuts the result.
          OMPL has no browser build, so this demo runs the same search in JavaScript. The Python backend's{" "}
          <code className="text-ink">firebot.planning.OMPLPlanner</code> uses the real OMPL bindings as a drop-in swap.
        </p>
      </details>
    </div>
  );
}
