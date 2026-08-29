import { useCallback, useRef } from "react";

type SoundType = "cardPlay" | "cardHit" | "coinGain" | "victory" | "defeat" | "bulkCall" | "materialGain";

interface GameSoundConfig {
  enabled: boolean;
  volume: number;
}

/**
 * ゲーム効果音を管理するカスタムフック
 * client/public/ に音声ファイルを配置してください：
 * - card-play.mp3: カード提出時
 * - card-hit.mp3: BALKU時
 * - coin-gain.mp3: コイン獲得時
 * - victory.mp3: 勝利時
 * - defeat.mp3: 敗北時
 * - bulk-call.mp3: BALKU発動時
 * - material-gain.mp3: 素材獲得時
 */
export function useGameSounds(config: GameSoundConfig = { enabled: true, volume: 0.5 }) {
  const audioContextRef = useRef<Map<SoundType, HTMLAudioElement> | null>(null);

  // 音声ファイルマッピング
  const soundFiles: Record<SoundType, string> = {
    cardPlay: "/sounds/card-play.mp3",
    cardHit: "/sounds/card-hit.mp3",
    coinGain: "/sounds/coin-gain.mp3",
    victory: "/sounds/victory.mp3",
    defeat: "/sounds/defeat.mp3",
    bulkCall: "/sounds/bulk-call.mp3",
    materialGain: "/sounds/material-gain.mp3",
  };

  const play = useCallback(
    (soundType: SoundType) => {
      if (!config.enabled) return;

      try {
        // Audio 要素のキャッシュを初期化
        if (!audioContextRef.current) {
          audioContextRef.current = new Map();
        }

        let audio = audioContextRef.current.get(soundType);

        if (!audio) {
          // 新しい Audio 要素を作成
          audio = new Audio(soundFiles[soundType]);
          audio.volume = config.volume;
          audio.preload = "auto";
          audioContextRef.current.set(soundType, audio);
        }

        // 再生前に先頭にリセット
        audio.currentTime = 0;
        audio.volume = config.volume;

        // 再生（エラーは無視）
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            // ブラウザの自動再生ポリシーなどでエラーが発生する可能性がある
          });
        }
      } catch (error) {
        console.warn(`Sound play failed for ${soundType}:`, error);
      }
    },
    [config.enabled, config.volume, soundFiles]
  );

  return {
    play,
    playCardPlay: () => play("cardPlay"),
    playCardHit: () => play("cardHit"),
    playCoinGain: () => play("coinGain"),
    playVictory: () => play("victory"),
    playDefeat: () => play("defeat"),
    playBulkCall: () => play("bulkCall"),
    playMaterialGain: () => play("materialGain"),
  };
}

// クライアント側でのサウンド効果音の生成（オプション：ファイルが無い場合の代替）
export function createFallbackAudio(type: SoundType): AudioBuffer | null {
  // Web Audio API を使用した簡単なビープ音生成（オプション実装）
  // 実装例：
  // const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  // const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.1, audioCtx.sampleRate);
  // const data = buffer.getChannelData(0);
  // for (let i = 0; i < buffer.length; i++) {
  //   data[i] = Math.sin(2 * Math.PI * i / (audioCtx.sampleRate / 440)) * 0.3;
  // }
  // return buffer;
  return null;
}
