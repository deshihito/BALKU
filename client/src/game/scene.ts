// BALKU / 現場図面アーケード: Babylonのシーンは描画基盤だけを持ち、ルールはGameWorldに委譲する。

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { GameWorld } from "./GameWorld";

export type GameHandle = {
  scene: Scene;
  dispose: () => void;
};

export async function createGameScene(engine: Engine, canvas: HTMLCanvasElement): Promise<GameHandle> {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.02, 0.07, 0.09, 1);
  const camera = new FreeCamera("balku-ui-camera", new Vector3(0, 0, -10), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.setTarget(Vector3.Zero());
  scene.activeCamera = camera;
  const demo = new URLSearchParams(window.location.search).has("demo");
  const world = new GameWorld(scene, canvas, demo);
  return {
    scene,
    dispose: () => {
      world.dispose();
      scene.dispose();
    },
  };
}
