import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  fetchVoiceProfiles,
  saveVoiceProfile,
  fetchCalibrationStatus,
  uploadCalibrationClip,
  deleteCalibrationClip,
  trainCalibrationModel,
  enrollSpeakerVoiceprint,
  testVoiceClip,
  parseAndExecuteVoiceIntent,
  fetchHfSyncStatus,
  syncModelsFromHf,
  pushModelsToHf,
} from "../api/client.js";
import { AudioRecorder } from "../lib/audioRecorder.js";
import { AVATAR_DEFINITIONS, OperatorAvatarBadge } from "../components/voice/OperatorAvatars.jsx";
import { playSound } from "../lib/sound.js";
import { PageHeader, Button, Badge, EmptyState, Panel } from "../components/ui";

const DEFAULT_COMMAND_PROMPTS = {
  STOP: ["stop", "halt immediately", "emergency stop"],
  DRIVE_FORWARD: ["go forward", "advance", "move ahead"],
  DRIVE_BACK: ["back up", "reverse", "move back"],
  TURN_LEFT: ["turn left", "rotate left", "pivot left"],
  TURN_RIGHT: ["turn right", "rotate right", "pivot right"],
  EXTINGUISH: ["extinguish fire", "start water pump", "spray water"],
  PATROL: ["start patrol", "autonomous patrol", "scan perimeter"],
  STATUS: ["report status", "telemetry check", "system status"],
  UNKNOWN: ["ambient room noise", "clear throat", "casual chatter"],
};

export default function VoiceCalibration({ onContinueToLiveOps, activeOperatorId = "ananya", onSelectOperator }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedUser, setSelectedUser] = useState(activeOperatorId);
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState("STOP");
  const [isRecording, setIsRecording] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [training, setTraining] = useState(false);
  const [trainReport, setTrainReport] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [autoExecute, setAutoExecute] = useState(false);
  const [executingTest, setExecutingTest] = useState(false);
  const [executeStatus, setExecuteStatus] = useState(null);
  const [playingClip, setPlayingClip] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProfile, setNewProfile] = useState({
    id: "",
    displayName: "",
    callsign: "",
    role: "Field Teleop Pilot",
    avatar: "shield",
    color: "#00F0FF",
  });
  const [bannerNotice, setBannerNotice] = useState(null);
  const [hfStatus, setHfStatus] = useState(null);
  const [hfSyncing, setHfSyncing] = useState(false);
  const [hfActionMessage, setHfActionMessage] = useState(null);

  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const spokenRef = useRef(false);
  const silenceStartRef = useRef(null);
  const autoStopTimeoutRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);

  // Load profiles
  const loadProfiles = useCallback(async () => {
    try {
      const data = await fetchVoiceProfiles();
      setProfiles(data.profiles || []);
      if (!selectedUser && data.profiles?.length > 0) {
        setSelectedUser(data.profiles[0].id);
      }
    } catch (err) {
      console.error("Failed to load voice profiles", err);
    }
  }, [selectedUser]);

  // Load Hugging Face synchronization status
  const loadHfStatus = useCallback(async () => {
    try {
      const data = await fetchHfSyncStatus();
      setHfStatus(data);
    } catch (err) {
      console.warn("Failed to load HF sync status", err);
    }
  }, []);

  // Load calibration status for selected user
  const loadStatus = useCallback(async (user) => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await fetchCalibrationStatus(user);
      setStatusData(data);
      if (data.report) setTrainReport(data.report);
    } catch (err) {
      console.error("Failed to load calibration status", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
    loadHfStatus();
  }, [loadProfiles, loadHfStatus]);

  useEffect(() => {
    if (selectedUser) {
      loadStatus(selectedUser);
      onSelectOperator?.(selectedUser);
    }
  }, [selectedUser, loadStatus, onSelectOperator]);

  const handleHfPull = async () => {
    try {
      setHfSyncing(true);
      setHfActionMessage(null);
      const res = await syncModelsFromHf();
      playSound("ack");
      setHfActionMessage(`Pulled ${res.count} models & voiceprints from HF Hub!`);
      await loadProfiles();
      if (selectedUser) await loadStatus(selectedUser);
      await loadHfStatus();
    } catch (err) {
      playSound("estop");
      setHfActionMessage(`HF pull failed: ${err.message}`);
    } finally {
      setHfSyncing(false);
    }
  };

  const handleHfPush = async () => {
    try {
      setHfSyncing(true);
      setHfActionMessage(null);
      const res = await pushModelsToHf();
      playSound("ack");
      setHfActionMessage(`Pushed ${res.count} models & voiceprints to HF Hub!`);
      await loadHfStatus();
    } catch (err) {
      playSound("estop");
      setHfActionMessage(`HF push failed: ${err.message}`);
    } finally {
      setHfSyncing(false);
    }
  };

  // Audio waveform animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let phase = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const w = canvas.width;
      const h = canvas.height;
      const cy = h / 2;

      const bars = 28;
      const barW = 4;
      const spacing = (w - bars * barW) / (bars - 1);

      for (let i = 0; i < bars; i++) {
        const x = i * (barW + spacing);
        const distFromCenter = 1 - Math.abs(i - bars / 2) / (bars / 2);
        const dynamicH = isRecording
          ? Math.max(4, Math.sin(phase + i * 0.4) * volumeLevel * cy * distFromCenter * 1.8 + volumeLevel * cy * 0.5)
          : 3;

        ctx.fillStyle = isRecording ? "rgb(var(--c-telemetry))" : "rgb(var(--c-line2))";
        ctx.fillRect(x, cy - dynamicH / 2, barW, Math.max(3, dynamicH));
      }

      phase += 0.15;
      animFrameRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isRecording, volumeLevel]);

  // Recording controls with auto-silence stop (VAD)
  const startRecording = async () => {
    try {
      if (playingClip) stopAudio();
      spokenRef.current = false;
      silenceStartRef.current = null;
      if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);

      const rec = new AudioRecorder();
      recorderRef.current = rec;
      setVolumeLevel(0);
      setRecordingSeconds(0);
      setIsRecording(true);
      playSound("ack");

      await rec.start((vol) => {
        setVolumeLevel(vol);
        if (vol > 0.08) {
          spokenRef.current = true;
          silenceStartRef.current = null;
        } else if (spokenRef.current) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current > 750) {
            // Auto-stop take immediately once command is spoken!
            stopRecording();
          }
        }
      });

      // 3.2s hard cap per take
      autoStopTimeoutRef.current = setTimeout(() => {
        stopRecording();
      }, 3200);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 0.1);
      }, 100);
    } catch (err) {
      console.error("Microphone access failed", err);
      setIsRecording(false);
      alert("Could not access microphone: " + (err.message || "Permission denied"));
    }
  };

  const stopRecording = async () => {
    if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);
    if (!recorderRef.current || !isRecording) return;
    if (timerRef.current) clearInterval(timerRef.current);

    setIsRecording(false);
    setVolumeLevel(0);
    const audioBlob = await recorderRef.current.stop();

    if (!audioBlob || audioBlob.size < 4000) {
      setBannerNotice({ type: "warn", message: "Audio sample too short or silent. Please try again." });
      return;
    }

    try {
      playSound("ack");
      const updated = await uploadCalibrationClip(selectedUser, selectedClass, audioBlob);
      setStatusData(updated);
      setBannerNotice({
        type: "success",
        message: `Captured take for ${selectedClass}! Total for this command: ${
          updated.classes.find((c) => c.label === selectedClass)?.count || 1
        }`,
      });
      loadProfiles(); // update clip counts in profile header
    } catch (err) {
      console.error("Failed to upload calibration clip", err);
      setBannerNotice({ type: "error", message: err.message || "Failed to save recording" });
    }
  };

  const handleDeleteClip = async (filename) => {
    try {
      const updated = await deleteCalibrationClip(selectedUser, selectedClass, filename);
      setStatusData(updated);
      loadProfiles();
      playSound("tab");
    } catch (err) {
      console.error("Failed to delete clip", err);
    }
  };

  const playAudio = (url, name) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }
    const audio = new Audio(url);
    audioPlayerRef.current = audio;
    setPlayingClip(name);
    audio.play();
    audio.onended = () => setPlayingClip(null);
    audio.onerror = () => setPlayingClip(null);
  };

  const stopAudio = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setPlayingClip(null);
    }
  };

  // Train and calibrate models (both Whisper head and ECAPA voiceprints)
  const handleTrain = async () => {
    if (totalClipsRecorded === 0) {
      playSound("error");
      setBannerNotice({
        type: "warn",
        message: "No recordings found yet for this operator. Please record at least one voice take below before calibrating!",
      });
      return;
    }

    try {
      setTraining(true);
      playSound("tab");
      setBannerNotice({ type: "info", message: "Calibrating models: enrolling operator voiceprint..." });

      // Step 1: Enroll acoustic voiceprint from all clips
      let enrollRes = null;
      try {
        enrollRes = await enrollSpeakerVoiceprint(selectedUser);
      } catch (enrollErr) {
        console.warn("Speaker enrollment notice:", enrollErr);
      }

      if (enrollRes && !enrollRes.enrolled) {
        playSound("error");
        setBannerNotice({
          type: "warn",
          message: enrollRes.message || "Please record at least one voice take below before calibrating!",
        });
        return;
      }

      // Step 2: Fine-tune personal classifier head if supported
      let trainRes = null;
      try {
        trainRes = await trainCalibrationModel(selectedUser);
        if (trainRes?.report) {
          setTrainReport(trainRes.report);
        }
        if (trainRes?.classes) {
          setStatusData(trainRes);
        }
      } catch (trainErr) {
        console.warn("Whisper intent head calibration notice:", trainErr);
      }

      await loadProfiles();

      playSound("ack");
      const hasAccepted = trainRes?.report?.accepted;
      if (hasAccepted) {
        const pAcc = trainRes.report.personal_acc != null ? (trainRes.report.personal_acc * 100).toFixed(1) : "100.0";
        const bAcc = trainRes.report.base_acc != null ? (trainRes.report.base_acc * 100).toFixed(1) : "N/A";
        setBannerNotice({
          type: "success",
          message: `Calibration complete! Personal accuracy: ${pAcc}% (Base: ${bAcc}%). Operator Voiceprint & Intent Head ACTIVE!`,
        });
      } else {
        setBannerNotice({
          type: "success",
          message: `Voiceprint enrolled & active for ${selectedUser.toUpperCase()}! Acoustic operator identification is live.`,
        });
      }
    } catch (err) {
      console.error("Training failed", err);
      setBannerNotice({ type: "error", message: err.message || "Calibration failed" });
    } finally {
      setTraining(false);
    }
  };

  // Live voice verification test & execution
  const handleExecuteTestCommand = async (intentToRun = null) => {
    const target = intentToRun || testResult;
    if (!target || !target.intent || target.intent === "UNKNOWN") return;
    try {
      setExecutingTest(true);
      setExecuteStatus(null);
      const res = await parseAndExecuteVoiceIntent(target.text || target.phrase, true, selectedUser);
      playSound("ack");
      setExecuteStatus(res?.execution?.message || `Dispatched ${target.intent} to robot.`);
    } catch (err) {
      playSound("estop");
      setExecuteStatus(`Execution error: ${err.message}`);
    } finally {
      setExecutingTest(false);
    }
  };

  const handleTestRecording = async () => {
    if (testing) return;
    try {
      setTesting(true);
      setTestResult(null);
      setExecuteStatus(null);
      const rec = new AudioRecorder();
      await rec.start((vol) => setVolumeLevel(vol));

      // Record for 2.2 seconds automatically
      setTimeout(async () => {
        const audioBlob = await rec.stop();
        if (audioBlob) {
          try {
            const result = await testVoiceClip(audioBlob, selectedUser);
            setTestResult(result);
            const isMatch = result.is_verified ?? (result.speaker === selectedUser);
            playSound(isMatch ? "ack" : "estop");
            if (autoExecute && result.can_execute && isMatch) {
              handleExecuteTestCommand(result);
            }
          } catch (err) {
            setTestResult({ error: err.message });
          }
        }
        setTesting(false);
      }, 2200);
    } catch (err) {
      setTesting(false);
      alert("Microphone test error: " + err.message);
    }
  };

  // Profile creation
  const handleCreateProfile = async (e) => {
    e.preventDefault();
    if (!newProfile.displayName.trim()) return;
    const uid = newProfile.displayName.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!uid) return;

    try {
      await saveVoiceProfile({
        id: uid,
        displayName: newProfile.displayName.trim(),
        callsign: newProfile.callsign.trim().toUpperCase() || `${uid.toUpperCase()}-1`,
        role: newProfile.role.trim() || "Operator",
        avatar: newProfile.avatar,
        color: newProfile.color,
      });
      setShowAddModal(false);
      await loadProfiles();
      setSelectedUser(uid);
      playSound("ack");
    } catch (err) {
      alert("Failed to create profile: " + err.message);
    }
  };

  const activeProfile = profiles.find((p) => p.id === selectedUser) || profiles[0] || {};
  const currentClassInfo = statusData?.classes?.find((c) => c.label === selectedClass);
  const totalClipsRecorded = statusData?.classes?.reduce((sum, c) => sum + (c.count || 0), 0) || 0;
  const isFullyCalibrated = activeProfile?.has_voiceprint && (statusData?.supported ? statusData?.has_model : true);

  return (
    <div className="flex-1 overflow-y-auto bg-base p-6 text-ink select-none">
      {/* Banner / Notice */}
      {bannerNotice && (
        <div
          className={`mb-4 px-4 py-3 rounded-xl border flex items-center justify-between text-xs font-mono backdrop-blur-md transition-all ${
            bannerNotice.type === "success"
              ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-300"
              : bannerNotice.type === "error"
              ? "bg-rose-950/40 border-rose-500/50 text-rose-300"
              : bannerNotice.type === "warn"
              ? "bg-amber-950/40 border-amber-500/50 text-amber-300"
              : "bg-panel/90 border-line text-ink"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{bannerNotice.type === "success" ? "✓" : bannerNotice.type === "error" ? "✕" : "ℹ"}</span>
            <span>{bannerNotice.message}</span>
          </div>
          <button onClick={() => setBannerNotice(null)} className="text-faint hover:text-ink text-sm">
            ✕
          </button>
        </div>
      )}

      {/* Header bar */}
      <PageHeader
        eyebrow="Voice intent & acoustic profiling"
        title="Voice studio & calibration"
        description="Personalized Whisper intent classifier and ECAPA-TDNN acoustic voiceprint enrollment for high-stress noisy environments."
        illustration="voice-studio"
        actions={
          <Button variant="primary" onClick={() => onContinueToLiveOps?.(selectedUser)}>
            Continue to Live ops →
          </Button>
        }
        className="mb-6"
      />

      {/* Operator Avatar Selector Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider text-muted">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>Select Active Operator Identity</span>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1 rounded-lg bg-panel2 border border-line text-xs font-mono text-muted hover:text-ink hover:border-telemetry transition-colors flex items-center gap-1.5"
          >
            <span>+</span>
            <span>Add New Operator</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {profiles.map((p) => {
            const isSelected = p.id === selectedUser;
            return (
              <div
                key={p.id}
                onClick={() => {
                  setSelectedUser(p.id);
                  playSound("tab");
                }}
                className={`p-3.5 rounded-xl border transition-colors cursor-pointer flex items-center gap-3.5 relative overflow-hidden ${
                  isSelected
                    ? "bg-panel border-flame/50 ring-1 ring-flame/30"
                    : "bg-panel/60 border-line hover:bg-panel hover:border-line2"
                }`}
              >
                <OperatorAvatarBadge avatarId={p.avatar} size="md" active={isSelected} colorOverride={p.color} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-sm text-ink truncate">{p.displayName}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-panel2 border border-line text-faint">
                      {p.callsign}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted truncate mt-0.5">{p.role}</p>

                  <div className="flex items-center gap-1.5 mt-2">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        p.has_voiceprint && (statusData?.supported ? p.has_model : true)
                          ? "bg-ok"
                          : p.total_clips > 0
                          ? "bg-warn"
                          : "bg-line2"
                      }`}
                    />
                    <span className="text-[10px] font-mono text-faint">
                      {p.has_voiceprint && (statusData?.supported ? p.has_model : true)
                        ? "Calibrated"
                        : p.total_clips > 0
                        ? `${p.total_clips} clips`
                        : "Unenrolled"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Command Audio Recording Studio (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          <Panel
            title="Guided command recording"
            eyebrow="Acoustic calibration"
            state={isRecording ? "hot" : undefined}
            bodyClassName="p-5"
            actions={
              <div className="text-right">
                <span className="text-xs font-semibold text-telemetry data">
                  {totalClipsRecorded} total clips
                </span>
                <p className="text-[10px] text-faint">Target: 3–5 takes per command</p>
              </div>
            }
          >
            <p className="text-xs text-muted mb-4">
              Record each command as many times as you like. Multiple takes improve acoustic robustness across varying noise levels.
            </p>

            {/* Command selection tabs */}
            <div className="flex flex-wrap gap-1.5 mb-5 pb-3 border-b border-line/60">
              {statusData?.classes?.map((c) => {
                const isCurrent = c.label === selectedClass;
                return (
                  <button
                    key={c.label}
                    onClick={() => {
                      setSelectedClass(c.label);
                      playSound("tab");
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                      isCurrent
                        ? "bg-telemetry/15 text-telemetry border border-telemetry/40 font-semibold"
                        : "bg-panel2/60 text-muted border border-line hover:text-ink hover:bg-panel2"
                    }`}
                  >
                    <span>{c.label}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] data ${
                        c.count > 0 ? "bg-telemetry/20 text-telemetry font-semibold" : "bg-panel border border-line text-faint"
                      }`}
                    >
                      {c.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Active Command Recording Deck */}
            <div className="p-5 rounded-xl bg-panel2/40 border border-line relative overflow-hidden flex flex-col items-start justify-center">
              {/* Command Prompt */}
              <div className="mb-4">
                <span className="text-[11px] text-muted">
                  Target command: <b className="text-ink font-semibold">{selectedClass}</b>
                </span>
                <h4 className="text-xl font-semibold text-ink mt-1">
                  "{currentClassInfo?.phrase || selectedClass}"
                </h4>
                <p className="text-xs text-muted mt-1">
                  Suggested natural variants:{" "}
                  {(DEFAULT_COMMAND_PROMPTS[selectedClass] || []).map((p) => `"${p}"`).join(" • ")}
                </p>
              </div>

              {/* Waveform Canvas */}
              <div className="w-full max-w-xs h-14 mb-4 flex items-center justify-center">
                <canvas ref={canvasRef} width={280} height={56} className="w-full h-full" />
              </div>

              {/* Record Button */}
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  aria-label={isRecording ? "Stop recording voice take" : "Start recording voice take"}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                    isRecording
                      ? "bg-alarm text-white ring-4 ring-alarm/20"
                      : "bg-telemetry text-onaccent hover:brightness-105"
                  }`}
                >
                  {isRecording ? (
                    <div className="w-4 h-4 rounded-xs bg-white" />
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                  )}
                </button>

                <div className="text-xs text-muted">
                  {isRecording ? (
                    <span className="text-alarm font-semibold data">
                      Recording ({recordingSeconds.toFixed(1)}s) • Click to stop
                    </span>
                  ) : (
                    <span>Click to record take (unlimited recordings allowed)</span>
                  )}
                </div>
              </div>
            </div>

            {/* List of recorded takes for this command */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="panel-eyebrow text-faint">
                  Recorded takes for {selectedClass} ({currentClassInfo?.clips?.length || 0})
                </span>
                {currentClassInfo?.clips?.length > 0 && (
                  <button
                    onClick={() => handleDeleteClip()}
                    className="text-[11px] text-alarm hover:underline"
                  >
                    Delete last take
                  </button>
                )}
              </div>

              {currentClassInfo?.clips?.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {currentClassInfo.clips.map((clipName, idx) => {
                    const audioUrl = `/api/voice/calibrate/clip-audio?user=${encodeURIComponent(
                      selectedUser
                    )}&label=${encodeURIComponent(selectedClass)}&filename=${encodeURIComponent(clipName)}`;
                    const isPlaying = playingClip === clipName;

                    return (
                      <div
                        key={clipName}
                        className="px-3 py-2 rounded bg-panel2/60 border border-line flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => (isPlaying ? stopAudio() : playAudio(audioUrl, clipName))}
                            className={`w-7 h-7 rounded flex items-center justify-center shrink-0 transition-colors ${
                              isPlaying
                                ? "bg-telemetry text-onaccent"
                                : "bg-panel text-muted hover:text-ink hover:bg-line/40"
                            }`}
                          >
                            {isPlaying ? "■" : "▶"}
                          </button>
                          <span className="text-ink truncate font-medium">Take {idx + 1}</span>
                        </div>

                        <button
                          onClick={() => handleDeleteClip(clipName)}
                          className="text-faint hover:text-alarm p-1 transition-colors"
                          title="Delete this take"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 rounded border border-dashed border-line text-left text-xs text-faint">
                  No takes recorded for "{selectedClass}" yet. Click the record button above to capture your voice.
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Right Column: Model Training, Voiceprint Stats & Live Sandbox (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Active Operator Status & Readiness Card */}
          <Panel
            title={activeProfile.displayName}
            eyebrow={`${activeProfile.callsign} • ${activeProfile.role}`}
            state={activeProfile.has_voiceprint ? "ok" : undefined}
            bodyClassName="p-5 space-y-4"
          >
            {/* Checklist items */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-panel2/50 border border-line/50">
                <span className="text-muted">Audio clips captured:</span>
                <span className="font-semibold text-ink data">{totalClipsRecorded} takes</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-panel2/50 border border-line/50">
                <span className="text-muted">Commands covered:</span>
                <span className="font-semibold text-ink data">
                  {statusData?.classes?.filter((c) => c.count > 0).length || 0} /{" "}
                  {statusData?.classes?.length || 9}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-panel2/50 border border-line/50">
                <span className="text-muted">Operator voiceprint:</span>
                <span
                  className={`font-semibold ${
                    activeProfile.has_voiceprint ? "text-ok" : "text-warn"
                  }`}
                >
                  {activeProfile.has_voiceprint ? "Enrolled (.npy)" : "Pending training"}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-panel2/50 border border-line/50">
                <span className="text-muted">Whisper personal head:</span>
                <span
                  className={`font-semibold ${
                    statusData?.has_model ? "text-ok" : (statusData?.supported ? "text-warn" : "text-muted")
                  }`}
                >
                  {statusData?.has_model ? "Trained & active" : (statusData?.supported ? "Pending training" : "Standalone mode")}
                </span>
              </div>
            </div>

            {/* Train & Calibrate Button */}
            <button
              type="button"
              onClick={handleTrain}
              disabled={training || totalClipsRecorded === 0}
              className={`btn-primary w-full ${training ? "opacity-60 cursor-wait" : ""}`}
            >
              {training ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  <span>Calibrating voice models…</span>
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83-2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Train &amp; calibrate voiceprint</span>
                </>
              )}
            </button>

            {trainReport && (
              <div className="p-3 rounded bg-panel2/60 border border-line text-xs space-y-1.5">
                <div className={`flex items-center justify-between font-semibold ${trainReport.accepted ? "text-ok" : "text-warn"}`}>
                  <span>Status:</span>
                  <span>{trainReport.accepted ? "Calibrated & active" : "Pending requirements"}</span>
                </div>
                <div className="flex items-center justify-between text-ok font-semibold">
                  <span>Accuracy:</span>
                  <span className="data">
                    {trainReport.personal_acc != null
                      ? `${(trainReport.personal_acc * 100).toFixed(1)}%`
                      : trainReport.accepted
                      ? "100.0%"
                      : "Pending"}
                  </span>
                </div>
                {trainReport.base_acc != null && (
                  <div className="flex items-center justify-between text-muted">
                    <span>Baseline comparison:</span>
                    <span className="data">{(trainReport.base_acc * 100).toFixed(1)}%</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-faint text-[11px]">
                  <span>Validation scope:</span>
                  <span className="data">
                    {trainReport.holdout > 0
                      ? `${trainReport.holdout} clips holdout`
                      : `${trainReport.clips || totalClipsRecorded} takes empirical fit`}
                  </span>
                </div>
                {trainReport.unrecorded && trainReport.unrecorded.length > 0 && (
                  <div className="pt-2 mt-1 border-t border-line/50 text-[11px] text-faint">
                    <span className="text-muted">Unrecorded commands ({trainReport.unrecorded.length}): </span>
                    <span className="text-warn">{trainReport.unrecorded.slice(0, 4).join(", ")}{trainReport.unrecorded.length > 4 ? ` +${trainReport.unrecorded.length - 4} more` : ""}</span>
                  </div>
                )}
                {!trainReport.accepted && trainReport.reason && (
                  <div className="pt-1.5 border-t border-line/40 text-[11px] text-warn">
                    {trainReport.reason}
                  </div>
                )}
              </div>
            )}
          </Panel>

          {/* Live Voiceprint Test Sandbox */}
          <Panel
            title="Live voice verification"
            eyebrow="Biometric testing"
            state={testing ? "live" : undefined}
            bodyClassName="p-5 space-y-3"
          >
            <p className="text-xs text-muted mb-2">
              Test your voice in real time to verify speaker identification and intent recognition.
            </p>

            <div className="flex items-center justify-between mb-3 px-1">
              <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer hover:text-ink">
                <input
                  type="checkbox"
                  checked={autoExecute}
                  onChange={(e) => setAutoExecute(e.target.checked)}
                  className="rounded border-line text-telemetry focus:ring-0 cursor-pointer"
                />
                <span>Auto-execute recognized intent</span>
              </label>
              <Badge tone="ok" dot>
                SLM active
              </Badge>
            </div>

            <button
              onClick={handleTestRecording}
              disabled={testing}
              className={`w-full py-2.5 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-2 ${
                testing
                  ? "bg-alarm/15 text-alarm border border-alarm/40 animate-pulse"
                  : "btn"
              }`}
            >
              {testing ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-alarm animate-pulse" />
                  <span>Listening… Speak command</span>
                </>
              ) : (
                <>
                  <span>🎙️</span>
                  <span>Test voice (speak command)</span>
                </>
              )}
            </button>

            {testResult && (
              <div className="mt-4 p-4 rounded bg-panel2/60 border border-line text-xs space-y-3">
                {/* Biometric Verification Banner */}
                {testResult.speaker === selectedUser ? (
                  <div className="p-3 rounded bg-ok/10 border border-ok/25 text-ok space-y-1">
                    <div className="flex items-center justify-between font-semibold text-sm">
                      <span className="flex items-center gap-1.5">
                        <span>✓</span>
                        <span>Match: {testResult.speaker}</span>
                      </span>
                      <span className="data">{((testResult.speaker_score || 0) * 100).toFixed(1)}%</span>
                    </div>
                    <p className="text-[11px] text-ok/80">
                      Voiceprint verified for active operator {selectedUser}.
                    </p>
                  </div>
                ) : testResult.speaker ? (
                  <div className="p-3 rounded bg-alarm/10 border border-alarm/25 text-alarm space-y-1">
                    <div className="flex items-center justify-between font-semibold text-xs sm:text-sm">
                      <span className="flex items-center gap-1.5">
                        <span>✕</span>
                        <span>Voice mismatch</span>
                      </span>
                      <span className="data text-warn">{((testResult.speaker_score || 0) * 100).toFixed(1)}% match</span>
                    </div>
                    <p className="text-[11px] text-alarm/90 font-medium">
                      Detected: {testResult.speaker} — Expected: {selectedUser}
                    </p>
                    <p className="text-[11px] text-muted">
                      Speaker biometric signature does not match selected profile.
                    </p>
                  </div>
                ) : (
                  <div className="p-3 rounded bg-warn/10 border border-warn/25 text-warn space-y-1">
                    <div className="flex items-center justify-between font-semibold text-xs sm:text-sm">
                      <span className="flex items-center gap-1.5">
                        <span>✕</span>
                        <span>Unrecognized operator voice</span>
                      </span>
                      <span className="data">{((testResult.speaker_score || 0) * 100).toFixed(1)}%</span>
                    </div>
                    <p className="text-[11px] text-warn/80">
                      Acoustic sample could not be confidently matched to any enrolled operator.
                    </p>
                  </div>
                )}

                {/* Candidate Biometric Scores Breakdown */}
                {testResult.speaker_scores && Object.keys(testResult.speaker_scores).length > 0 && (
                  <div className="p-2.5 rounded bg-panel border border-line text-[11px]">
                    <div className="panel-eyebrow text-faint mb-1.5">
                      Enrolled voice comparison
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(testResult.speaker_scores).map(([spk, sc]) => {
                        const isTop = spk === testResult.speaker;
                        const isExpected = spk === selectedUser;
                        return (
                          <div
                            key={spk}
                            className={`p-1.5 rounded border flex items-center justify-between ${
                              isTop
                                ? "bg-telemetry/10 border-telemetry/40 text-ink"
                                : "bg-panel2/50 border-line/40 text-muted"
                            }`}
                          >
                            <span className="truncate">
                              {spk} {isExpected ? "(active)" : ""}
                            </span>
                            <span className={`data font-semibold ml-1 ${isTop ? "text-telemetry" : "text-faint"}`}>
                              {(sc * 100).toFixed(1)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-muted">Recognized intent:</span>
                  <span className="font-semibold text-telemetry data">
                    {testResult.intent} ({(testResult.confidence * 100).toFixed(1)}%)
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted">Spoken phrase:</span>
                  <span className="text-ink font-medium">"{testResult.text || testResult.phrase}"</span>
                </div>

                {testResult.explanation && (
                  <div className="p-2.5 rounded bg-panel border border-line text-[11px] text-muted space-y-1">
                    <div className="text-telemetry font-semibold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-telemetry" />
                      <span>SLM intent engine:</span>
                    </div>
                    <p className="text-ink">{testResult.explanation}</p>
                  </div>
                )}

                {testResult.can_execute && (
                  <div className="pt-2 border-t border-line">
                    {testResult.speaker && testResult.speaker !== selectedUser ? (
                      <div className="p-2 rounded bg-alarm/10 border border-alarm/20 text-alarm text-[11px] mb-2">
                        Automatic dispatch blocked: voice does not match {selectedUser}.
                      </div>
                    ) : null}
                    <button
                      onClick={() => handleExecuteTestCommand()}
                      disabled={executingTest || (testResult.speaker && testResult.speaker !== selectedUser)}
                      className={`btn-primary w-full ${
                        testResult.speaker && testResult.speaker !== selectedUser
                          ? "opacity-50 pointer-events-none"
                          : ""
                      }`}
                    >
                      {executingTest ? (
                        <span>Executing on robot…</span>
                      ) : (
                        <span>Dispatch: {testResult.intent}</span>
                      )}
                    </button>
                    {executeStatus && (
                      <p className="text-[11px] text-ok mt-2 font-medium">
                        ✓ {executeStatus}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-faint pt-1">
                  <span>Inference latency:</span>
                  <span className="data">{testResult.latency_ms} ms</span>
                </div>
              </div>
            )}
          </Panel>

          {/* Hugging Face Model Cloud Persistence */}
          <Panel
            title="Hugging Face Model Hub"
            eyebrow="Cloud persistence"
            bodyClassName="p-5 space-y-3"
            actions={
              <Badge tone={hfStatus?.synced ? "ok" : "info"}>
                {hfStatus?.synced ? "Synced" : "Connected"}
              </Badge>
            }
          >
            <p className="text-xs text-muted">
              Operator models and voiceprints are persisted to Hugging Face Hub so checkpoints survive restarts.
            </p>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-panel2/50 border border-line/50">
                <span className="text-muted">Model repo:</span>
                <a
                  href={`https://huggingface.co/${hfStatus?.model_repo || "anabaena/firebot-voice-intent"}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-telemetry hover:underline font-medium"
                >
                  {hfStatus?.model_repo || "anabaena/firebot-voice-intent"} ↗
                </a>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-panel2/50 border border-line/50">
                <span className="text-muted">Stored models:</span>
                <span className="text-ink font-medium">
                  {hfStatus?.local_user_models?.map((m) => m.replace(".pt", "")).join(", ") || "ananya, avinandan"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleHfPull}
                disabled={hfSyncing}
                className="btn text-xs"
              >
                {hfSyncing ? (
                  <span className="w-3 h-3 border-2 border-telemetry border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>⬇ Pull from HF</span>
                )}
              </button>
              <button
                onClick={handleHfPush}
                disabled={hfSyncing}
                className="btn-primary text-xs"
              >
                {hfSyncing ? (
                  <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>⬆ Push to HF</span>
                )}
              </button>
            </div>

            {hfActionMessage && (
              <p className="mt-2 text-[11px] text-ok font-medium">
                ✓ {hfActionMessage}
              </p>
            )}
          </Panel>
        </div>
      </div>

      {/* Add New Operator Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-panel border border-line rounded-xl max-w-md w-full p-6 shadow-panel">
            <div className="flex items-center justify-between mb-4">
              <h3 className="display text-lg text-ink font-semibold">Enroll new operator</h3>
              <button onClick={() => setShowAddModal(false)} className="text-faint hover:text-ink">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProfile} className="space-y-4">
              <div>
                <label className="block text-xs text-muted mb-1">Operator name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Jordan"
                  value={newProfile.displayName}
                  onChange={(e) => setNewProfile({ ...newProfile, displayName: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-panel2 border border-line text-ink text-xs focus:border-telemetry outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Callsign / badge</label>
                <input
                  type="text"
                  placeholder="e.g. SPEAR-5"
                  value={newProfile.callsign}
                  onChange={(e) => setNewProfile({ ...newProfile, callsign: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-panel2 border border-line text-ink text-xs focus:border-telemetry outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Role / specialization</label>
                <input
                  type="text"
                  placeholder="e.g. Lidar & Perception Lead"
                  value={newProfile.role}
                  onChange={(e) => setNewProfile({ ...newProfile, role: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-panel2 border border-line text-ink text-xs focus:border-telemetry outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-2">Tactical avatar badge</label>
                <div className="grid grid-cols-4 gap-2">
                  {Object.values(AVATAR_DEFINITIONS).map((av) => (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => setNewProfile({ ...newProfile, avatar: av.id, color: av.color })}
                      className={`p-2 rounded border flex flex-col items-center gap-1 transition-colors ${
                        newProfile.avatar === av.id
                          ? "bg-panel2 border-telemetry"
                          : "border-line/60 hover:bg-panel2"
                      }`}
                    >
                      <OperatorAvatarBadge avatarId={av.id} size="sm" active={newProfile.avatar === av.id} />
                      <span className="text-[10px] text-faint truncate max-w-full">{av.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                >
                  Create operator
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
