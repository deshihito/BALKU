// BALKU / 現場図面アーケード: Reactは製図台の額縁、BabylonとGameWorldが盤面とルールを所有する。

import { useEffect, useRef } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createGameScene, type GameHandle } from "@/game/scene";

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || startedRef.current) return;
    startedRef.current = true;
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      adaptToDeviceRatio: true,
    });
    let handle: GameHandle | null = null;
    createGameScene(engine, canvas).then((created) => {
      handle = created;
      engine.runRenderLoop(() => created.scene.render());
    });
    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      handle?.dispose();
      engine.dispose();
      startedRef.current = false;
    };
  }, []);

  return <canvas ref={canvasRef} aria-label="BALKU ブラウザカードゲーム" className="fixed inset-0 h-full w-full outline-none" style={{ touchAction: "none" }} />;
}
