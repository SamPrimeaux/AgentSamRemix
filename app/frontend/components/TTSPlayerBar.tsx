import React, { useState } from 'react';
import { UseSpeechSynthesisReturn } from '../hooks/useSpeechSynthesis';

interface TTSPlayerBarProps {
  tts: UseSpeechSynthesisReturn;
  onClose: () => void;
}

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];

export const TTSPlayerBar: React.FC<TTSPlayerBarProps> = ({ tts, onClose }) => {
  const [showVoicePicker, setShowVoicePicker] = useState(false);

  if (!tts.isSpeaking && !tts.isPaused) {
    return null;
  }

  return (
    <div className="tts-player-bar" role="region" aria-label="Text to speech player">
      <div className="tts-player-left">
        {/* Animated wave / state icon */}
        <div className={`tts-waveform ${tts.isSpeaking && !tts.isPaused ? 'playing' : 'paused'}`}>
          <span className="tts-wave-bar" />
          <span className="tts-wave-bar" />
          <span className="tts-wave-bar" />
          <span className="tts-wave-bar" />
        </div>

        {/* Play/Pause Button */}
        <button
          onClick={() => {
            if (tts.isPaused) {
              tts.resume();
            } else {
              tts.pause();
            }
          }}
          className="tts-ctrl-btn primary"
          title={tts.isPaused ? 'Resume reading' : 'Pause reading'}
          aria-label={tts.isPaused ? 'Resume reading' : 'Pause reading'}
        >
          <span className="material-symbols-outlined">
            {tts.isPaused ? 'play_arrow' : 'pause'}
          </span>
        </button>

        {/* Stop Button */}
        <button
          onClick={tts.stop}
          className="tts-ctrl-btn"
          title="Stop reading"
          aria-label="Stop reading"
        >
          <span className="material-symbols-outlined">stop</span>
        </button>

        {/* Status text & snippet */}
        <div className="tts-info">
          <div className="tts-status-row">
            <span className="tts-status-tag">
              {tts.isPaused ? 'PAUSED' : 'READING ALOUD'}
            </span>
            {tts.totalChunks > 0 && (
              <span className="tts-chunk-count">
                Section {tts.currentChunkIndex + 1} of {tts.totalChunks} ({tts.progressPercent}%)
              </span>
            )}
          </div>
          {tts.currentTextSnippet && (
            <div className="tts-snippet" title={tts.currentTextSnippet}>
              "{tts.currentTextSnippet}"
            </div>
          )}
        </div>
      </div>

      <div className="tts-player-right">
        {/* Speed Selector */}
        <div className="tts-speed-selector">
          {SPEEDS.map(s => (
            <button
              key={s}
              className={`tts-speed-btn ${tts.rate === s ? 'active' : ''}`}
              onClick={() => tts.setRate(s)}
              title={`Playback speed ${s}x`}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Voice Selector button & dropdown */}
        {tts.voices.length > 1 && (
          <div className="tts-voice-container">
            <button
              className={`tts-ctrl-btn tts-voice-btn ${showVoicePicker ? 'active' : ''}`}
              onClick={() => setShowVoicePicker(prev => !prev)}
              title="Select Voice"
              aria-label="Select Voice"
            >
              <span className="material-symbols-outlined">record_voice_over</span>
            </button>

            {showVoicePicker && (
              <div className="tts-voice-menu">
                <div className="tts-voice-menu-header">Select Voice</div>
                <div className="tts-voice-list">
                  {tts.voices.map(voice => (
                    <button
                      key={`${voice.name}-${voice.lang}`}
                      className={`tts-voice-item ${tts.selectedVoice?.name === voice.name ? 'selected' : ''}`}
                      onClick={() => {
                        tts.setSelectedVoice(voice);
                        setShowVoicePicker(false);
                      }}
                    >
                      <span className="tts-voice-name">{voice.name}</span>
                      <span className="tts-voice-lang">{voice.lang}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Close Bar Button */}
        <button
          onClick={() => {
            tts.stop();
            onClose();
          }}
          className="tts-ctrl-btn close-btn"
          title="Close text-to-speech player"
          aria-label="Close text-to-speech player"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
  );
};
