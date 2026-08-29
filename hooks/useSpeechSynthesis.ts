import { useState, useEffect, useRef, useCallback } from 'react';
import { extractTextFromHtml, splitTextIntoChunks } from '../utils/ttsHelpers';

export interface UseSpeechSynthesisReturn {
  isSupported: boolean;
  isSpeaking: boolean;
  isPaused: boolean;
  rate: number;
  setRate: (rate: number) => void;
  pitch: number;
  setPitch: (pitch: number) => void;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  setSelectedVoice: (voice: SpeechSynthesisVoice | null) => void;
  currentTextSnippet: string;
  currentChunkIndex: number;
  totalChunks: number;
  progressPercent: number;
  speak: (htmlContent: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  togglePlayPause: (htmlContent?: string) => void;
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rate, setRateState] = useState<number>(1.0);
  const [pitch, setPitchState] = useState<number>(1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoiceState] = useState<SpeechSynthesisVoice | null>(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [currentTextSnippet, setCurrentTextSnippet] = useState('');

  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const chunksRef = useRef<string[]>([]);
  const chunkIndexRef = useRef<number>(0);
  const isSpeakingRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const rateRef = useRef<number>(1.0);
  const pitchRef = useRef<number>(1.0);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Sync ref values
  const setRate = useCallback((newRate: number) => {
    rateRef.current = newRate;
    setRateState(newRate);
  }, []);

  const setPitch = useCallback((newPitch: number) => {
    pitchRef.current = newPitch;
    setPitchState(newPitch);
  }, []);

  const setSelectedVoice = useCallback((voice: SpeechSynthesisVoice | null) => {
    selectedVoiceRef.current = voice;
    setSelectedVoiceState(voice);
  }, []);

  // Populate voices
  useEffect(() => {
    if (!isSupported) return;

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available && available.length > 0) {
        setVoices(available);
        if (!selectedVoiceRef.current) {
          // Select default English or system default voice
          const defaultVoice =
            available.find(v => v.lang.startsWith('en') && v.default) ||
            available.find(v => v.lang.startsWith('en')) ||
            available[0];
          if (defaultVoice) {
            setSelectedVoice(defaultVoice);
          }
        }
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      if (isSupported) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isSupported, setSelectedVoice]);

  // Clean stop
  const stop = useCallback(() => {
    if (!isSupported) return;
    isSpeakingRef.current = false;
    isPausedRef.current = false;
    chunksRef.current = [];
    chunkIndexRef.current = 0;
    try {
      window.speechSynthesis.cancel();
    } catch { }

    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentChunkIndex(0);
    setTotalChunks(0);
    setCurrentTextSnippet('');
  }, [isSupported]);

  // Next chunk speaker
  const speakNextChunk = useCallback(() => {
    if (!isSupported || !isSpeakingRef.current) return;

    if (chunkIndexRef.current >= chunksRef.current.length) {
      // Completed reading all chunks
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentChunkIndex(0);
      setTotalChunks(0);
      setCurrentTextSnippet('');
      return;
    }

    const chunk = chunksRef.current[chunkIndexRef.current];
    setCurrentTextSnippet(chunk);
    setCurrentChunkIndex(chunkIndexRef.current);

    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = rateRef.current;
    utterance.pitch = pitchRef.current;
    if (selectedVoiceRef.current) {
      utterance.voice = selectedVoiceRef.current;
    }

    utterance.onend = () => {
      if (isSpeakingRef.current && !isPausedRef.current) {
        chunkIndexRef.current += 1;
        speakNextChunk();
      }
    };

    utterance.onerror = (e) => {
      // If stopped/canceled, ignore
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      console.warn('Utterance error:', e.error);
      if (isSpeakingRef.current && !isPausedRef.current) {
        chunkIndexRef.current += 1;
        speakNextChunk();
      }
    };

    window.speechSynthesis.speak(utterance);
  }, [isSupported]);

  const pause = useCallback(() => {
    if (!isSupported || !isSpeakingRef.current) return;
    try {
      window.speechSynthesis.pause();
      isPausedRef.current = true;
      setIsPaused(true);
    } catch (e) {
      console.warn('Speech pause error', e);
    }
  }, [isSupported]);

  const resume = useCallback(() => {
    if (!isSupported || !isSpeakingRef.current) return;
    try {
      window.speechSynthesis.resume();
      isPausedRef.current = false;
      setIsPaused(false);
    } catch (e) {
      console.warn('Speech resume error', e);
    }
  }, [isSupported]);

  const speak = useCallback((htmlContent: string) => {
    if (!isSupported) {
      console.warn('SpeechSynthesis is not supported in this browser.');
      return;
    }

    // Stop current speech
    try {
      window.speechSynthesis.cancel();
    } catch { }

    const plainText = extractTextFromHtml(htmlContent);
    if (!plainText) {
      console.log('No text found on page to read aloud.');
      return;
    }

    const chunks = splitTextIntoChunks(plainText);
    if (chunks.length === 0) return;

    chunksRef.current = chunks;
    chunkIndexRef.current = 0;
    isSpeakingRef.current = true;
    isPausedRef.current = false;

    setTotalChunks(chunks.length);
    setCurrentChunkIndex(0);
    setIsSpeaking(true);
    setIsPaused(false);

    speakNextChunk();
  }, [isSupported, speakNextChunk]);

  const togglePlayPause = useCallback((htmlContent?: string) => {
    if (!isSpeaking) {
      if (htmlContent) {
        speak(htmlContent);
      }
    } else if (isPaused) {
      resume();
    } else {
      pause();
    }
  }, [isSpeaking, isPaused, speak, resume, pause]);

  const progressPercent =
    totalChunks > 0 ? Math.min(100, Math.round(((currentChunkIndex + 1) / totalChunks) * 100)) : 0;

  return {
    isSupported,
    isSpeaking,
    isPaused,
    rate,
    setRate,
    pitch,
    setPitch,
    voices,
    selectedVoice,
    setSelectedVoice,
    currentTextSnippet,
    currentChunkIndex,
    totalChunks,
    progressPercent,
    speak,
    pause,
    resume,
    stop,
    togglePlayPause,
  };
}
