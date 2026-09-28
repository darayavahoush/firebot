// Reference list for the Voice tab -- kept in sync with parseIntent() in lib/simEngine.js,
// which itself mirrors command/{intents,parser}.py. If a trigger word is added there, add it here too.
export const COMMAND_HELP = [
  { intent: "STOP", fn: "Halts immediately: motors and pump off, latched until the next command. Checked first and wins over every other intent, so it is deliberately over-eager.",
    examples: ["stop", "halt", "freeze", "abort", "cancel", "emergency stop", "hold on / hold position", "shut it off", "kill the pump", "enough", "whoa"] },
  { intent: "EXTINGUISH", fn: "Resumes autonomous search, approach, suppress. Any mention of fire or smoke also triggers it, even without an explicit verb.",
    examples: ["put out the fire", "extinguish", "douse", "suppress", "spray", "find the fire", "search", "start", "resume", "carry on", "patrol", "there's smoke"] },
  { intent: "GOTO", fn: "Drives to a named waypoint or compass direction, or to explicit coordinates.",
    examples: ["go to the east side", "go to the top right", "go to the center", "go to five three", "go to x 8.5 y 6", "navigate to the northwest corner"] },
  { intent: "RETURN_HOME", fn: "Routes back to the dock.", examples: ["come back home", "return to base", "go home", "return", "head to dock"] },
  { intent: "STATUS", fn: "Reports mode, position, tank and battery level and the current fire estimate. No motion.",
    examples: ["status", "report", "how much water is left", "where are you", "what do you see", "battery", "what's going on"] },
];
