// BALKU / 現場図面アーケード: 余白のない全画面製図台をゲーム専用のルートとして提示する。

import { Toaster } from "@/components/ui/sonner";
import Home from "@/pages/Home";

// BALKU online: ロビーと同期盤面は同じ公開導線上に置き、対戦参加を妨げない。
export default function App() {
  return <><Home /><Toaster richColors position="top-center" /></>;
}
