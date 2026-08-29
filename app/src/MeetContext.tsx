import { createContext, useContext, ReactNode } from 'react';

export interface MeetParticipant {
  user_id: string;
  display_name: string;
  session_id: string;
  tracks: string[];
  audioMuted?: boolean;
  videoMuted?: boolean;
  isSpeaking?: boolean;
}

export interface MeetCtxValue {
  phase: 'lobby' | 'connecting' | 'in-call' | 'ended';
  roomId: string;
  roomName: string;
  displayName: string;
  participants: MeetParticipant[];
  audioOn: boolean;
  videoOn: boolean;
  screenOn: boolean;
  recording: boolean;
  setPhase: (v: 'lobby' | 'connecting' | 'in-call' | 'ended') => void;
  setRoomId: (v: string) => void;
  setRoomName: (v: string) => void;
  setDisplayName: (v: string) => void;
  setParticipants: (v: MeetParticipant[]) => void;
  setAudioOn: (v: boolean) => void;
  setVideoOn: (v: boolean) => void;
  setScreenOn: (v: boolean) => void;
  setRecording: (v: boolean) => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  toggleScreen: () => void;
  endCall: () => void;
  // AI Studio
  runAiStudio: (item: string) => void;
  aiStudioOpen: string | null;
  aiStudioResult: string | null;
  // Invite modal
  showInvite: boolean;
  setShowInvite: (v: boolean) => void;
}

const MeetCtx = createContext<MeetCtxValue | null>(null);

export function useMeet() {
  const ctx = useContext(MeetCtx);
  if (!ctx) throw new Error('useMeet must be inside MeetProvider');
  return ctx;
}

export function MeetProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: MeetCtxValue;
}) {
  return <MeetCtx.Provider value={value}>{children}</MeetCtx.Provider>;
}
