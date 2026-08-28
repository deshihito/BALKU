import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, BookOpen, Check, CircleDot, Clock3, Coins, Copy, Gavel, Globe, Hammer, LogOut, PackageOpen, Play, Plus, RotateCcw, ShieldAlert, ShoppingBag, Sparkles, Users, X, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { sortHandCards } from "@/lib/handSort";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Session = { code: string; playerToken: string };
type MaterialKind = "木材" | "鉄骨" | "コンクリート" | "ガラス" | "銅線" | "合金" | "超伝導体" | "ゴミ";
type EffectType = "coins" | "draw" | "gainMaterial" | "randomMaterial" | "randomProject" | "pointBoost" | "income" | "randomMaterialIncome" | "mysteryHouse" | "stealCoins" | "stealCard" | "discard" | "forceBulk";
type Card = { id: string; kind: "material" | "project"; name: string; material?: MaterialKind; rarity?: "premium"; points?: number; requirements?: Record<string, number>; immediate?: boolean; effect?: { type: EffectType; label: string; material?: MaterialKind } };
type Submission = { id: string; project: Card; faceUp: boolean; legal: boolean; effectActivated: boolean; materialCount: number };
type ForceBulkCharge = { id: string; sourceProject: string; used: boolean };
type Player = { seat: number; name: string; coins: number; hand: Card[]; handCount: number; submitted: Submission[]; eliminated: boolean; actionUsed: boolean; scoreBonus: number; forceBulkCharges: ForceBulkCharge[] };
type FinalScore = { seat: number; name: string; points: number; submittedPoints: number; bonusPoints: number };
type RoomState = { phase: "lobby" | "active" | "finished"; turn: number; activeSeat: number; turnDeadlineAt: number | null; deckCount: number; deckInitialCount: number; players: Player[]; logs: { id: string; text: string; tone: "neutral" | "good" | "warning" | "danger"; createdAt: number }[]; auction: { card: Card; highestBid: number; highestBidderSeat: number | null; deadlineAt?: number; roundOpened: number } | null; winnerSeat: number | null; winnerSeats: number[]; finalScores: FinalScore[] };
type CutIn = { logId: string; eyebrow: string; title: string; detail: string; tone: "good" | "warning" | "danger"; marker: "build" | "inspect" | "market" | "final" };

const MATERIAL_STYLE: Record<string, string> = {
  木材: "border-orange-300/70 bg-orange-950/50 text-orange-200",
  鉄骨: "border-slate-300/50 bg-slate-800/80 text-slate-100",
  コンクリート: "border-stone-300/50 bg-stone-700/80 text-stone-100",
  ガラス: "border-cyan-300/70 bg-cyan-950/55 text-cyan-100",
  銅線: "border-amber-400/60 bg-amber-950/50 text-amber-100",
  合金: "border-violet-300/70 bg-violet-950/55 text-violet-100",
  超伝導体: "border-fuchsia-300 bg-gradient-to-br from-fuchsia-950 to-indigo-950 text-fuchsia-100",
  ゴミ: "border-gray-400/50 bg-gray-700/60 text-gray-200",
};

const MARKET: { material: MaterialKind; price: number }[] = [
  { material: "木材", price: 5 },
  { material: "鉄骨", price: 5 },
  { material: "コンクリート", price: 5 },
  { material: "ガラス", price: 5 },
  { material: "銅線", price: 5 },
  { material: "合金", price: 7 },
  { material: "超伝導体", price: 10 },
  { material: "ゴミ", price: 1 },
];

const TARGETED_EFFECTS: EffectType[] = ["stealCoins", "discard"];
const SESSION_KEY = "balku-room-session";
const TUTORIAL_KEY = "balku-tutorial-seen";

function readSession(): Session | null { try { const raw = window.sessionStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) as Session : null; } catch { return null; } }
function requirements(card: Card) { const values = Object.entries(card.requirements ?? {}); return values.length ? values.map(([name, count]) => `${name}×${count}`).join("  ") : "素材不要・即時発動"; }
function scoreOf(player: Player | undefined) { return (player?.submitted ?? []).reduce((sum, entry) => sum + (entry.project.points ?? 0), 0) + (player?.scoreBonus ?? 0); }

function toCutIn(entry: RoomState["logs"][number] | undefined): CutIn | null {
  if (!entry) return null;
  const detail = entry.text; const base = { logId: entry.id, detail };
  if (detail.includes("強制BALKU発動")) return { ...base, eyebrow: "EMERGENCY INSPECTION", title: "確定BALKU", tone: "danger", marker: "inspect" };
  if (detail.includes("BALKU成功")) return { ...base, eyebrow: "INSPECTION CLEAR", title: "違法建築を接収", tone: "good", marker: "inspect" };
  if (detail.includes("BALKU失敗")) return { ...base, eyebrow: "INSPECTION BACKFIRE", title: "BALKU 失敗", tone: "danger", marker: "inspect" };
  if (detail.includes("自動オークション成立")) return { ...base, eyebrow: "MARKET SETTLED", title: "落札成立", tone: "good", marker: "market" };
  if (detail.includes("自動オークション不成立")) return { ...base, eyebrow: "MARKET WITHDRAWN", title: "入札なし・取り下げ", tone: "warning", marker: "market" };
  if (detail.includes("自動オークション開始")) return { ...base, eyebrow: "MARKET OPEN", title: "競り開始", tone: "warning", marker: "market" };
  if (detail.includes("直接獲得")) return { ...base, eyebrow: "DIRECT PROCUREMENT", title: "資材を調達", tone: "good", marker: "market" };
  if (detail.includes("売却")) return { ...base, eyebrow: "SALVAGE POCKET", title: "カードを売却", tone: "good", marker: "market" };
  if (detail.includes("山札消尽")) return { ...base, eyebrow: "DECK EXHAUSTED", title: "最終精算", tone: "warning", marker: "final" };
  if (detail.includes("公開で") || detail.includes("伏せ企画を完成")) return { ...base, eyebrow: "CONSTRUCTION LOG", title: detail.includes("伏せ") ? "伏せて企画提出" : "公開で企画完成", tone: "good", marker: "build" };
  return null;
}

function GameCutIn({ cutIn }: { cutIn: CutIn }) {
  const theme = cutIn.tone === "danger" ? "border-[#ef756c] bg-[#35191d] text-[#ffd5d0]" : cutIn.tone === "warning" ? "border-[#f2c94c] bg-[#3b3218] text-[#fff0b1]" : "border-[#57dba0] bg-[#12362e] text-[#d5ffe6]";
  const Marker = cutIn.marker === "inspect" ? ShieldAlert : cutIn.marker === "market" ? Gavel : cutIn.marker === "final" ? Check : Hammer;
  return <div className="pointer-events-none fixed inset-x-0 top-5 z-[70] flex justify-center px-4" role="status" aria-live="polite"><section className={`balku-cutin relative w-full max-w-xl overflow-hidden border px-5 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.52)] ${theme}`}><div className="absolute inset-0 blueprint-grid opacity-20" /><div className="balku-cutin-tape absolute inset-x-0 top-0 h-1.5" /><div className="relative flex items-center gap-4"><div className="grid h-11 w-11 shrink-0 place-items-center border border-current/50 bg-black/15"><Marker size={23} /></div><div className="min-w-0"><p className="text-[9px] font-bold tracking-[0.2em] opacity-70">{cutIn.eyebrow}</p><h2 className="mt-0.5 font-display text-3xl font-bold leading-none tracking-wide">{cutIn.title}</h2><p className="mt-1 line-clamp-1 text-xs font-medium opacity-85">{cutIn.detail}</p></div></div></section></div>;
}

function CardFace({ card, selected = false, onClick, onPreview, onDragStart, onDragEnd, compact = false, draggable = false }: { card: Card; selected?: boolean; onClick?: () => void; onPreview?: () => void; onDragStart?: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd?: () => void; compact?: boolean; draggable?: boolean }) {
  const longPressTimer = useRef<number | null>(null); const previewed = useRef(false);
  const clearLongPress = () => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = null; };
  const startLongPress = () => { if (!onPreview) return; previewed.current = false; longPressTimer.current = window.setTimeout(() => { previewed.current = true; onPreview(); }, 460); };
  const materialClass = card.kind === "material" ? MATERIAL_STYLE[card.material ?? ""] ?? "border-slate-500 bg-slate-900 text-white" : "border-[#c6af80] bg-[#f1e6cc] text-[#182830]";
  return <button type="button" draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onPointerDown={startLongPress} onPointerUp={clearLongPress} onPointerCancel={clearLongPress} onPointerLeave={clearLongPress} onKeyDown={(event) => { if (event.key === " " && onPreview) { event.preventDefault(); onPreview(); } }} onClick={() => { if (previewed.current) { previewed.current = false; return; } onClick?.(); }} data-card-action="hand-arrival" className={`balku-card-action group relative flex shrink-0 flex-col overflow-hidden rounded-md border text-left shadow-[0_9px_16px_rgba(0,0,0,0.25)] transition duration-150 hover:-translate-y-1 hover:shadow-[0_16px_22px_rgba(0,0,0,0.34)] active:scale-[0.98] ${compact ? "h-[106px] w-[118px] p-2" : "h-[151px] w-[132px] p-3"} ${materialClass} ${selected ? "ring-3 ring-[#f2c94c] ring-offset-2 ring-offset-[#10232a]" : ""}`} aria-pressed={selected} aria-label={`${card.name}${onPreview ? "。長押しまたはスペースキーで詳細" : ""}`}>
    <span className={`absolute inset-x-0 top-0 h-1 ${card.kind === "project" ? "bg-[#39bfe8]" : "bg-current opacity-60"}`} />
    {card.rarity === "premium" && <span className="absolute right-2 top-2 rounded bg-fuchsia-300/20 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-fuchsia-100">PREMIUM</span>}
    <span className="mt-1 text-[9px] font-bold tracking-[0.11em] opacity-75">{card.kind === "project" ? card.immediate ? "即時企画 / PLAN" : "素材企画 / PLAN" : `素材 / ${card.rarity === "premium" ? "RARE" : "MATERIAL"}`}</span>
    <span className={`${compact ? "mt-2 text-[15px]" : "mt-3 text-[18px]"} font-bold leading-tight`}>{card.name}</span>
    {card.kind === "project" ? <><span className="mt-2 text-[10px] leading-snug opacity-70">{requirements(card)}</span><span className="mt-auto flex items-end justify-between gap-1 text-xs font-bold text-[#1b5b6f]"><span>{card.effect?.label}</span><span className="font-display text-[22px] text-[#bc5c43]">{card.points} PT</span></span></> : <><span className="mt-3 text-xs opacity-65">資材区分</span><span className="text-sm font-bold">{card.material}</span><span className="mt-auto text-[11px] font-bold opacity-70">施工・売却に使える</span></>}
  </button>;
}

function CardPreview({ card, open, onOpenChange, onSell }: { card: Card | null; open: boolean; onOpenChange: (open: boolean) => void; onSell?: (card: Card) => void }) {
  if (!card) return null;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md border-[#39bfe8]/60 bg-[#10262d] text-[#edf0e4]"><DialogHeader><DialogTitle className="font-display text-3xl tracking-wide">カード詳細</DialogTitle><DialogDescription className="text-[#a9c3c7]">長押し、またはスペースキーで開けます。</DialogDescription></DialogHeader><div className="mx-auto py-2"><CardFace card={card} compact /></div><div className="rounded border border-[#55bed6]/30 bg-[#091a20] p-4 text-sm leading-6"><p className="font-bold text-[#f4ead1]">{card.name}</p><p className="mt-2 text-[#b4cbce]">{card.kind === "project" ? `${requirements(card)} / ${card.effect?.label ?? "効果なし"} / ${card.points ?? 0} PT` : `資材区分：${card.material}${card.rarity === "premium" ? "（高級素材）" : ""}`}</p></div>{onSell && <button type="button" onClick={() => onSell(card)} className="rounded border border-[#63d8a2]/60 bg-[#2f9e6d] px-4 py-3 text-sm font-bold text-white">カードを売却 +1 coin</button>}</DialogContent></Dialog>;
}

function SubmittedPile({ submission, owner, isSelf, onBulk, onForceBulk, hasForceBulk }: { submission: Submission; owner: Player; isSelf: boolean; onBulk?: () => void; onForceBulk?: () => void; hasForceBulk: boolean }) {
  const hidden = !submission.faceUp && !isSelf;
  const canBulk = !isSelf && !owner.eliminated && (!submission.faceUp || !submission.effectActivated);
  return <div data-card-action="construction-land" className={`balku-pile-enter relative w-[146px] ${hidden ? "hazard-card" : ""}`}><div className="absolute inset-x-2 top-[10px] h-[100px] rounded border border-[#9d7344] bg-[#9b633e] shadow-sm" /><div className={`relative min-h-[120px] rounded border-2 p-3 shadow-lg ${hidden ? "border-[#f2c94c] bg-[#182930] text-[#f4ead1]" : submission.legal ? "border-[#2698b5] bg-[#f2e6cc] text-[#1d3138]" : "border-[#e36a61] bg-[#f5dfd5] text-[#2f2020]"}`}><p className={`text-[9px] font-bold tracking-[0.1em] ${hidden ? "text-[#f2c94c]" : submission.legal ? "text-[#24677d]" : "text-red-600"}`}>{hidden ? "非開示企画 / HIDDEN" : submission.legal ? "承認済み / APPROVED" : "違法疑義 / RISK"}</p><p className="mt-2 text-[15px] font-bold leading-tight">{hidden ? "企画書 — 非開示" : submission.project.name}</p><p className="mt-3 text-[10px] opacity-70">添付素材 {submission.materialCount} 枚</p>{!hidden && <p className="mt-1 font-display text-[22px] font-bold text-[#b95037]">{submission.project.points} PT</p>}{canBulk && <div className="mt-3 grid gap-1.5"><button type="button" onClick={onBulk} className="w-full rounded bg-[#f2c94c] px-2 py-1.5 text-[11px] font-bold text-[#172329] transition hover:bg-[#ffdb67] active:scale-95">BALKU</button>{hasForceBulk && <button type="button" onClick={onForceBulk} className="w-full rounded bg-[#dd5a51] px-2 py-1.5 text-[10px] font-bold text-white transition hover:bg-[#ef756c] active:scale-95">確定BALKU</button>}</div>}</div></div>;
}

function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const slides = [{ eyebrow: "01 / 入室", title: "チュートリアルを閉じると\nゲームが開始されます。", body: "このゲームは企画を完成させポイントを稼ぐゲームです。" }, { eyebrow: "02 / 施工", title: "企画を置き、\n素材を納める。", body: "自身のターンに任意の企画カードを選び、対応する素材を選択します" }, { eyebrow: "03 / 違法建築", title: "企画カードに書かれていない素材も企画カードに使えます。\nこれを違法建築と言います\n表向きで提出した場合違法建築とみなされますが、\n裏向きで提出すれば違法建築とみなされません。", body: "主なアクション\n・カードを選択\n・企画を納品\n・右上のショップから任意の素材を購入\nオークションにコインを入札\nカードを長押しで売却" }, { eyebrow: "04 / BALKU", title: "伏せた企画あるいは違法建築をBALKUする事ができます。", body: "BALKUの対象が違法建築である場合はその企画カードと素材カードを押収できます。\n違法建築でない場合は対象企画のポイントあるいはそれ以上のポイントを自身の手札の企画からロストされます。\n捨てられる企画がない場合ゲームオーバーとなります。" }, { eyebrow: "05 / 精算", title: "勝利条件", body: "合計ポイントで順位が決定します。" }];
  const slide = slides[step];
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-[#07151b]/90 px-5 backdrop-blur-sm"><section className="relative w-full max-w-lg overflow-hidden rounded-xl border border-[#39bfe8]/50 bg-[#10252d] shadow-2xl"><div className="blueprint-grid absolute inset-0 opacity-35" /><div className="relative p-7 sm:p-10"><p className="text-xs font-bold tracking-[0.18em] text-[#39bfe8]">{slide.eyebrow}</p><h2 className="mt-4 whitespace-pre-line font-display text-4xl font-bold leading-[0.92] text-[#f4ead1] sm:text-5xl">{slide.title}</h2><p className="mt-6 max-w-md leading-7 text-[#b7c7c8]">{slide.body}</p><div className="mt-10 flex items-center justify-between gap-4"><div className="flex gap-1.5">{slides.map((_, index) => <span key={index} className={`h-1.5 w-7 rounded ${index === step ? "bg-[#39bfe8]" : "bg-white/20"}`} />)}</div><button type="button" onClick={() => step === slides.length - 1 ? onClose() : setStep(step + 1)} className="rounded bg-[#f2c94c] px-5 py-3 text-sm font-bold text-[#16262b]">{step === slides.length - 1 ? "盤面へ進む" : "次へ"}</button></div><button type="button" onClick={onClose} className="absolute right-4 top-4 rounded p-2 text-[#9eb2b5] hover:bg-white/10 hover:text-white" aria-label="チュートリアルを閉じる"><X size={20} /></button></div></section></div>;
}

function Lobby({ onSession }: { onSession: (value: Session) => void }) {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [showTutorial, setShowTutorial] = useState(() => new URLSearchParams(window.location.search).has("tutorial"));
  const [isPublic, setIsPublic] = useState(true);
  const [showPublicRooms, setShowPublicRooms] = useState(false);

  const getPublicRooms = trpc.balku.getPublicRooms.useQuery(undefined, {
    enabled: showPublicRooms,
    refetchInterval: 3000,
  });

  const createRoom = trpc.balku.createRoom.useMutation({ onSuccess: onSession, onError: (error) => toast.error(error.message) });
  const joinRoom = trpc.balku.joinRoom.useMutation({ onSuccess: onSession, onError: (error) => toast.error(error.message) });
  const busy = createRoom.isPending || joinRoom.isPending;

  return (
    <main className="min-h-screen bg-[#07151b] text-[#edf0e4]">
      <div className="relative min-h-screen overflow-hidden px-5 py-8 sm:px-10">
        <div className="desk-art absolute inset-0" />
        <div className="blueprint-grid absolute inset-0 opacity-25" />
        <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col justify-between">
          <header className="flex items-start justify-between border-b border-[#72cfe5]/20 pb-5">
            <div className="flex items-center gap-3">
              <img src="/manus-storage/balku-logo-mark_b603e974.png" alt="BALKU" className="h-14 w-14 object-contain" />
              <div>
                <p className="font-display text-4xl font-bold leading-none tracking-tight">BALKU</p>
                <p className="mt-1 text-[10px] font-bold tracking-[0.16em] text-[#39bfe8]">BUILDER / ONLINE FIELD TEST</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowTutorial(true)} className="rounded border border-[#39bfe8]/45 bg-[#102b33]/80 px-3 py-2 text-xs font-bold text-[#91e2f4]">
              <BookOpen className="mr-1 inline h-3.5 w-3.5" />ルール確認
            </button>
          </header>

          <section className="grid gap-8 py-12 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
            <div>
              <p className="text-xs font-bold tracking-[0.18em] text-[#39bfe8]">BUILD ・ INSPECT ・ OUTBID</p>
              <h1 className="mt-4 max-w-xl font-display text-6xl font-bold leading-[0.82] tracking-tight text-[#f4ead1] sm:text-7xl">
                図面どおりか。<br /><span className="text-[#f2c94c]">BALKU</span><br />違法建築を見抜け
              </h1>
              <p className="mt-7 max-w-lg leading-7 text-[#b6c7c9]">
                素材を集め、企画書を積み、疑わしければ検査を仕掛ける。山札が尽きた時、一番ポイントを持ったものが勝利。
              </p>
            </div>

            <section className="rounded-xl border border-[#61cce5]/35 bg-[#10262d]/95 p-5 shadow-[0_25px_70px_rgba(0,0,0,0.45)] sm:p-7">
              <div className="flex items-center gap-2 text-[#f4ead1]">
                <Users size={18} className="text-[#39bfe8]" />
                <h2 className="font-display text-2xl font-bold">現場に入る</h2>
              </div>
              
              <label className="mt-6 block text-xs font-bold tracking-wide text-[#8eb6bd]">ユーザー名</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={24}
                placeholder="例：〇〇建設"
                className="mt-2 w-full rounded border border-[#6ea6b1]/40 bg-[#08171c] px-4 py-3 text-[#f4ead1] outline-none placeholder:text-[#587176] focus:border-[#39bfe8]"
              />

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setMaxPlayers(count)}
                    className={`rounded border px-3 py-2 text-sm font-bold ${maxPlayers === count ? "border-[#39bfe8] bg-[#39bfe8]/15 text-[#8be0f8]" : "border-white/10 text-[#90a8ab]"}`}
                  >
                    {count}人卓
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPublic"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-[#08171c] text-[#39bfe8] focus:ring-[#39bfe8]"
                />
                <label htmlFor="isPublic" className="text-xs font-bold text-[#90a8ab] cursor-pointer select-none">
                  公開ルームとして作成する
                </label>
              </div>

              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => createRoom.mutate({ displayName: name, maxPlayers, isPublic })}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-[#39bfe8] px-4 py-3.5 font-bold text-[#0b2027] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={18} />新しい現場を作成
              </button>

              <div className="my-4 flex items-center gap-2 text-[10px] font-bold tracking-widest text-[#638087]">
                <span className="h-px flex-1 bg-white/10" />
                または参加
                <span className="h-px flex-1 bg-white/10" />
              </div>

              <button
                type="button"
                onClick={() => setShowPublicRooms(true)}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded border border-[#39bfe8]/50 bg-[#39bfe8]/10 px-4 py-2.5 text-sm font-bold text-[#8fe0f8] hover:bg-[#39bfe8]/20"
              >
                <Globe size={16} />公開ルーム一覧を見る
              </button>

              <div className="flex gap-2">
                <input
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6))}
                  placeholder="ルームコード 6文字"
                  className="min-w-0 flex-1 rounded border border-[#6ea6b1]/40 bg-[#08171c] px-4 py-3 font-mono tracking-[0.13em] text-[#f4ead1] outline-none"
                />
                <button
                  type="button"
                  disabled={busy || !name.trim() || roomCode.length !== 6}
                  onClick={() => joinRoom.mutate({ code: roomCode, displayName: name })}
                  className="rounded bg-[#f2c94c] px-4 font-bold text-[#15262a] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowRight size={20} />
                </button>
              </div>
            </section>
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#72cfe5]/20 pt-5 text-[11px] text-[#7fa0a6]">
            <span>FIELD TEST / ルーム内の状態は数秒以内に更新されます</span>
            <span>this game is created by lunamOOn</span>
          </footer>
        </div>
      </div>

      <Dialog open={showPublicRooms} onOpenChange={setShowPublicRooms}>
        <DialogContent className="max-w-md border-[#39bfe8]/60 bg-[#10262d] text-[#edf0e4]">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-[#f4ead1]">公開中の現場一覧</DialogTitle>
            <DialogDescription className="text-[#a9c3c7]">参加可能な現場を選択してください。</DialogDescription>
          </DialogHeader>

          <div className="mt-2 max-h-60 overflow-y-auto space-y-2 pr-1">
            {getPublicRooms.isLoading ? (
              <p className="py-4 text-center text-xs text-[#81abb3]">現場一覧を読み込み中…</p>
            ) : getPublicRooms.data && getPublicRooms.data.length > 0 ? (
              getPublicRooms.data.map((room) => (
                <div
                  key={room.code}
                  className="flex items-center justify-between rounded border border-white/10 bg-[#08171c] p-3 text-sm"
                >
                  <div>
                    <span className="font-mono font-bold tracking-wider text-[#39bfe8]">{room.code}</span>
                    <span className="ml-3 text-xs text-[#81abb3]">
                      {room.playerCount} / {room.maxPlayers}人
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy || !name.trim() || room.playerCount >= room.maxPlayers}
                    onClick={() => {
                      setShowPublicRooms(false);
                      joinRoom.mutate({ code: room.code, displayName: name });
                    }}
                    className="rounded bg-[#f2c94c] px-3 py-1.5 text-xs font-bold text-[#15262a] disabled:opacity-40"
                  >
                    参加
                  </button>
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-xs text-[#81abb3]">現在参加可能な公開現場はありません。</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
    </main>
  );
}

function OnlineRoom({ session, leave }: { session: Session; leave: () => void }) {
  const utils = trpc.useUtils(); const [selectedPlan, setSelectedPlan] = useState<string | null>(null); const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]); const [selectedTarget, setSelectedTarget] = useState<number | null>(null); const [tutorial, setTutorial] = useState(() => window.sessionStorage.getItem(TUTORIAL_KEY) !== "1"); const [cutIn, setCutIn] = useState<CutIn | null>(null); const [clockNow, setClockNow] = useState(() => Date.now()); const [shopOpen, setShopOpen] = useState(false); const [previewCard, setPreviewCard] = useState<Card | null>(null); const [draggingCard, setDraggingCard] = useState<string | null>(null); const [saleFlash, setSaleFlash] = useState(false); const [startTransition, setStartTransition] = useState(false); const seenLogIds = useRef<Set<string> | null>(null); const lastRoomRevision = useRef<number | null>(null); const previousPhase = useRef<RoomState["phase"] | null>(null);
  const room = trpc.balku.getRoom.useQuery(session, { refetchInterval: 2000, retry: false, refetchOnWindowFocus: true }); const move = trpc.balku.move.useMutation({ onSuccess: () => utils.balku.getRoom.invalidate(session), onError: (error) => { toast.error(error.message); utils.balku.getRoom.invalidate(session); } }); const start = trpc.balku.startGame.useMutation({ onSuccess: () => utils.balku.getRoom.invalidate(session), onError: (error) => toast.error(error.message) }); const restart = trpc.balku.restartGame.useMutation({ onSuccess: () => utils.balku.getRoom.invalidate(session), onError: (error) => toast.error(error.message) });
  const data = room.data as unknown as { code: string; status: "lobby" | "active" | "finished"; revision: number; maxPlayers: number; player: { seat: number; displayName: string; isHost: boolean }; state: RoomState } | undefined; const state = data?.state; const ownSeat = data?.player.seat ?? -1; const me = state?.players.find((player) => player.seat === ownSeat); const active = state?.players.find((player) => player.seat === state.activeSeat); const isTurn = state?.phase === "active" && state.activeSeat === ownSeat && !me?.eliminated; const opponents = state?.players.filter((player) => player.seat !== ownSeat) ?? []; const selectedProject = me?.hand.find((card) => card.id === selectedPlan && card.kind === "project"); const requiresTarget = selectedProject ? TARGETED_EFFECTS.includes(selectedProject.effect?.type ?? "coins") : false; const handKey = useMemo(() => me?.hand.map((card) => card.id).join("|") ?? "", [me?.hand]); const sortedHand = useMemo(() => sortHandCards(me?.hand ?? []), [me?.hand]); const forceCharges = me?.forceBulkCharges ?? []; const forceCharge = forceCharges.find((charge) => !charge.used); const usedForceCharges = forceCharges.filter((charge) => charge.used).length; const isFinished = state?.phase === "finished"; const sellSelection = [...(selectedPlan ? [selectedPlan] : []), ...selectedMaterials]; const endgame = !isFinished && (state?.deckCount ?? 99) <= 10;
  useEffect(() => { setSelectedPlan(null); setSelectedMaterials([]); setSelectedTarget(null); }, [handKey]);
  useEffect(() => { if (previousPhase.current === "lobby" && state?.phase === "active") { setStartTransition(true); const timer = window.setTimeout(() => setStartTransition(false), 840); previousPhase.current = state.phase; return () => window.clearTimeout(timer); } if (state?.phase) previousPhase.current = state.phase; }, [state?.phase]);
  useEffect(() => { const logs = state?.logs ?? []; if (!data || !logs.length) return; if (seenLogIds.current === null || lastRoomRevision.current === null) { seenLogIds.current = new Set(logs.map((entry) => entry.id)); lastRoomRevision.current = data.revision; return; } if (lastRoomRevision.current === data.revision) return; lastRoomRevision.current = data.revision; const unseen = logs.filter((entry) => !seenLogIds.current!.has(entry.id)); if (!unseen.length) return; unseen.forEach((entry) => seenLogIds.current!.add(entry.id)); const candidates = unseen.map(toCutIn).filter((entry): entry is CutIn => entry !== null); const nextCutIn = candidates.find((entry) => ["最終精算", "強制 BALKU", "違法建築を接収", "BALKU 失敗", "落札成立", "入札なし・取り下げ", "カードを売却"].includes(entry.title)) ?? candidates[0]; if (!nextCutIn) return; setCutIn(nextCutIn); const timer = window.setTimeout(() => setCutIn((current) => current?.logId === nextCutIn.logId ? null : current), 2600); return () => window.clearTimeout(timer); }, [data?.revision, state?.logs]);
  useEffect(() => { if (!state?.turnDeadlineAt || state.phase !== "active") return; setClockNow(Date.now()); const timer = window.setInterval(() => setClockNow(Date.now()), 250); return () => window.clearInterval(timer); }, [state?.phase, state?.turnDeadlineAt]);
  const apply = (action: unknown) => { if (data) move.mutate({ code: session.code, playerToken: session.playerToken, expectedRevision: data.revision, action: action as never }); };
  const closeTutorial = () => { window.sessionStorage.setItem(TUTORIAL_KEY, "1"); setTutorial(false); };
  const toggleCard = (card: Card) => { if (!isTurn || me?.actionUsed || isFinished) return; if (card.kind === "project") { setSelectedPlan((value) => value === card.id ? null : card.id); setSelectedTarget(null); } else setSelectedMaterials((value) => value.includes(card.id) ? value.filter((id) => id !== card.id) : [...value, card.id]); };
  const addBuildMaterial = (id: string) => { const card = me?.hand.find((item) => item.id === id); if (!selectedProject || card?.kind !== "material") return; setSelectedMaterials((value) => value.includes(id) ? value : [...value, id]); };
  const startCardDrag = (card: Card) => (event: DragEvent<HTMLButtonElement>) => { if (!isTurn || me?.actionUsed) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", card.id); setDraggingCard(card.id); };
  const readDragCard = (event: DragEvent<HTMLElement>) => event.dataTransfer.getData("text/plain");
  const sellCards = (ids: string[]) => { const unique = Array.from(new Set(ids)); if (!isTurn || !unique.length || move.isPending) return; setSaleFlash(true); window.setTimeout(() => setSaleFlash(false), 450); if (unique.includes(selectedPlan ?? "")) setSelectedPlan(null); setSelectedMaterials((value) => value.filter((id) => !unique.includes(id))); apply({ type: "sellCards", cardIds: unique }); };
  const submitProject = (faceUp: boolean) => { if (!selectedProject) return; apply({ type: "submit", projectId: selectedProject.id, materialIds: selectedMaterials, faceUp, ...(selectedTarget !== null ? { targetSeat: selectedTarget } : {}) }); };
  if (room.isLoading || !data || !state) return <main className="grid min-h-screen place-items-center bg-[#07151b] text-[#c7d9dc]"><div className="text-center"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[#39bfe8] border-t-transparent" /><p className="mt-4 text-sm">現場図面を読み込んでいます…</p></div></main>;
  if (room.isError) return <main className="grid min-h-screen place-items-center bg-[#07151b] p-6 text-[#e6efee]"><div className="max-w-md rounded-lg border border-red-400/50 bg-[#1c2c30] p-7 text-center"><AlertTriangle className="mx-auto text-red-400" /><h1 className="mt-4 font-display text-3xl font-bold">現場に接続できません</h1><button type="button" onClick={leave} className="mt-6 rounded bg-[#f2c94c] px-4 py-2 font-bold text-[#19292e]">入口へ戻る</button></div></main>;
  if (state.phase === "lobby") return <main className="min-h-screen bg-[#07151b] p-5 text-[#edf0e4] sm:p-10"><div className="desk-art fixed inset-0 opacity-30" /><section className="relative mx-auto max-w-4xl rounded-xl border border-[#39bfe8]/35 bg-[#10262d]/95 p-6 shadow-2xl sm:p-10"><header className="flex flex-wrap items-start justify-between gap-5 border-b border-white/10 pb-6"><div className="flex gap-3"><img src="/manus-storage/balku-logo-mark_b603e974.png" alt="BALKU" className="h-14 w-14" /><div><p className="font-display text-4xl font-bold leading-none">BALKU</p><p className="mt-1 text-xs tracking-widest text-[#39bfe8]">LOBBY / FIELD BRIEFING</p></div></div><button type="button" onClick={leave} className="rounded border border-white/15 p-2 text-[#9eb4b8]" title="入口へ戻る"><LogOut size={18} /></button></header><div className="mt-8 grid gap-8 md:grid-cols-[1fr_0.9fr]"><div><p className="text-xs font-bold tracking-widest text-[#82cbe0]">ROOM CODE</p><strong className="mt-2 block font-display text-6xl tracking-[0.1em] text-[#f4ead1]">{data.code}</strong><p className="mt-5 max-w-sm leading-7 text-sm text-[#b2c4c6]">コードを共有。</p></div><div><p className="text-xs font-bold tracking-widest text-[#82cbe0]">現場参加者 {state.players.length} / {data.maxPlayers}</p><div className="mt-3 space-y-2">{state.players.map((player) => <div key={player.seat} className="flex items-center justify-between rounded border border-white/10 bg-[#09191e] px-4 py-3"><span className="flex items-center gap-3 font-bold"><CircleDot size={16} className={player.seat === 0 ? "text-[#39bfe8]" : "text-[#f2c94c]"} />{player.name}</span><span className="text-xs text-[#81abb3]">施工準備中</span></div>)}</div>{data.player.isHost ? <button type="button" disabled={state.players.length < 2 || start.isPending} onClick={() => start.mutate({ code: session.code, playerToken: session.playerToken, expectedRevision: data.revision })} className="mt-5 flex w-full items-center justify-center gap-2 rounded bg-[#39bfe8] px-4 py-3.5 font-bold text-[#0a2027] disabled:cursor-not-allowed disabled:opacity-40"><Play size={18} fill="currentColor" />施工を開始する</button> : <div className="mt-5 rounded border border-[#39bfe8]/30 bg-[#39bfe8]/10 px-4 py-4 text-center text-sm text-[#92dff1]">作成者が施工開始を操作するのを待っています。</div>}</div></div></section></main>;
  const activeIncome = me?.submitted.filter((submission) => submission.legal && submission.effectActivated && submission.project.effect?.type === "income").length ?? 0; const winningSeats = state.winnerSeats ?? (state.winnerSeat === null || state.winnerSeat === undefined ? [] : [state.winnerSeat]); const finalScores = state.finalScores ?? []; const ownWins = winningSeats.includes(ownSeat); const sharedWin = winningSeats.length > 1; const secondsLeft = state.turnDeadlineAt ? Math.max(0, Math.ceil((state.turnDeadlineAt - clockNow) / 1000)) : 0; const urgent = secondsLeft <= 10; const auctionSeconds = state.auction?.deadlineAt ? Math.max(0, Math.ceil((state.auction.deadlineAt - clockNow) / 1000)) : null;
  return <main className="min-h-screen overflow-x-hidden bg-[#07151b] pb-24 text-[#edf0e4]"><div className="desk-art fixed inset-0 opacity-55" /><div className="blueprint-grid fixed inset-0 opacity-[0.08]" />{startTransition && <div className="balku-start-overlay pointer-events-none fixed inset-0 z-[75] grid place-items-center bg-[#07151b]"><div className="text-center"><Hammer className="mx-auto h-12 w-12 text-[#f2c94c]" /><p className="mt-4 font-display text-5xl tracking-widest text-[#f4ead1]">SITE OPEN</p><p className="mt-2 text-xs font-bold tracking-[0.25em] text-[#39bfe8]">施工図面を展開中</p></div></div>}{cutIn && <GameCutIn cutIn={cutIn} />}<div className="relative mx-auto max-w-[1520px] p-3 sm:p-5"><header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#72cfe5]/20 pb-3"><div className="flex items-center gap-3"><img src="/manus-storage/balku-logo-mark_b603e974.png" alt="BALKU" className="h-10 w-10" /><div><p className="font-display text-3xl font-bold leading-none">BALKU</p><p className="text-[9px] font-bold tracking-[0.16em] text-[#39bfe8]">ROOM {data.code} / AUTO SYNC</p></div></div><div className={`rounded border px-4 py-2 text-center ${isTurn ? "border-[#39bfe8] bg-[#39bfe8]/10 text-[#8fe2f6]" : "border-[#f2c94c]/35 bg-[#f2c94c]/10 text-[#f2d972]"}`}><p className="text-[10px] font-bold tracking-widest">TURN {String(state.turn).padStart(2, "0")} / DECK {state.deckCount}</p><p className="text-sm font-bold">{isFinished ? "最終精算 完了" : isTurn ? "あなたの施工ターン" : `${active?.name ?? "参加者"}の施工を待機中`}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setShopOpen(true)} className="rounded border border-[#f2c94c]/50 bg-[#f2c94c]/10 px-3 py-2 text-xs font-bold text-[#f6da78]"><ShoppingBag className="mr-1 inline h-4 w-4" />ショップ</button><button type="button" onClick={() => setTutorial(true)} className="rounded border border-white/15 p-2 text-[#9ab8bd]" title="チュートリアル"><BookOpen size={17} /></button><button type="button" onClick={leave} className="rounded border border-white/15 p-2 text-[#9ab8bd]" title="退出"><LogOut size={17} /></button></div></header>{isTurn && <section className={`mt-3 rounded-lg border p-3 shadow-[0_14px_36px_rgba(0,0,0,0.28)] ${urgent ? "border-[#ef756c] bg-[#3a1d20]" : "border-[#39bfe8]/75 bg-[#12333c]"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className={`text-[10px] font-bold tracking-[0.18em] ${urgent ? "text-[#ffb4ad]" : "text-[#82def3]"}`}>YOUR TURN / ACTION REQUIRED</p><p className="font-display text-2xl font-bold tracking-wide text-[#f5ead2]">{selectedProject ? "施工ポケットへ素材を納品" : "企画を選ぶ、またはカードを売却"}</p></div><div className={`rounded border px-3 py-2 text-center ${urgent ? "border-[#ef756c]/60 bg-[#641f25] text-[#ffd7d2]" : "border-[#78d7ed]/50 bg-[#0c232b] text-[#b8edf7]"}`}><Clock3 className="mr-1 inline h-4 w-4" /><strong className="font-display text-2xl">{secondsLeft}</strong><span className="ml-1 text-xs">秒</span></div></div></section>}{endgame && <section className="balku-sale-flash mt-3 flex items-center gap-3 rounded border border-[#ef756c]/65 bg-[#3a1f20] px-4 py-3 text-[#ffd7d2]"><AlertTriangle className="h-5 w-5 shrink-0 text-[#f2c94c]" /><div><p className="text-xs font-bold tracking-[0.12em]">FINAL TEN / 通知</p><p className="text-sm">山札は残り {state.deckCount} 枚。施工と市場の判断を急いでください。</p></div></section>}<section className="mt-3 grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_280px]"><aside className="rounded-lg border border-[#65c6de]/25 bg-[#10262d]/95 p-3 shadow-xl"><p className="text-[10px] font-bold tracking-[0.14em] text-[#39bfe8]">YOUR STATUS</p><p className="mt-2 font-display text-4xl font-bold text-[#f4ead1]">{scoreOf(me)}<span className="ml-1 text-lg text-[#7d9ba1]">PT</span></p><p className="mt-1 text-sm text-[#f2c94c]"><Coins className="mr-1 inline h-4 w-4" />{me?.coins ?? 0} coins</p><p className="mt-2 text-[11px] text-[#79d9f2]">残山札 {state.deckCount} / {state.deckInitialCount}</p>{activeIncome > 0 && <p className="mt-2 text-[11px] text-[#72e2a7]"><Sparkles className="mr-1 inline h-3.5 w-3.5" />継続収入 +{activeIncome}</p>}{forceCharges.length > 0 && <p className={`mt-2 text-[11px] ${forceCharge ? "text-[#f1c86b]" : "text-[#9caeb0]"}`}><Zap className="mr-1 inline h-3.5 w-3.5" />確定BALKU {forceCharge ? `使用可能 ${forceCharges.length - usedForceCharges}回` : "使用済み"}</p>}</aside><section className="min-w-0 rounded-lg border border-[#44bad3]/60 bg-[#eee0c0] p-3 text-[#1b3035] shadow-[0_22px_55px_rgba(0,0,0,0.38)]"><div className="flex items-center justify-between border-b border-[#2c94ab]/30 pb-2"><div><p className="text-[10px] font-bold tracking-[0.13em] text-[#367082]">SITE PLAN / 提出済み企画エリア</p><p className="font-display text-xl font-bold">現場図面 — FINAL SCORE {state.deckCount === 0 ? "CALCULATING" : "PENDING"}</p></div><span className="rounded border border-[#478aa0]/35 px-2 py-1 text-[10px] font-bold text-[#3f7080]">{state.players.filter((player) => !player.eliminated).length} 社 稼働中</span></div><div className="mt-3 grid gap-2 md:grid-cols-3">{opponents.map((player) => <article key={player.seat} className={`rounded border p-2 ${player.eliminated ? "border-red-400/40 bg-red-50/40 opacity-70" : "border-[#477885]/40 bg-[#f8efd9]"}`}><div className="flex items-center justify-between"><span className="font-bold">{player.name}</span><span className="text-xs font-bold text-[#b35b3d]">{scoreOf(player)} PT</span></div><p className="mt-1 text-[10px] text-[#668087]">企画 {player.submitted.length}件 ・ 手札 {player.handCount}枚 ・ ◉ {player.coins}</p><div className="mt-2 flex min-h-[138px] gap-2 overflow-x-auto pb-1">{player.submitted.length ? player.submitted.map((submission) => <SubmittedPile key={submission.id} submission={submission} owner={player} isSelf={false} hasForceBulk={Boolean(forceCharge)} onBulk={() => apply({ type: "bulkCall", targetSeat: player.seat, submissionId: submission.id })} onForceBulk={() => forceCharge && apply({ type: "forceBulk", chargeId: forceCharge.id, targetSeat: player.seat, submissionId: submission.id })} />) : <div className="grid min-h-[118px] w-full place-items-center rounded border border-dashed border-[#5591a0]/40 text-xs text-[#69878e]">提出企画なし</div>}</div></article>)}</div><article className="mt-3 rounded border-2 border-[#2d96af] bg-[#fff5df] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[10px] font-bold tracking-[0.14em] text-[#237187]">YOUR YARD / あなたの施工ヤード</p><p className="mt-1 font-display text-2xl font-bold">{me?.name}</p></div><div className="text-right"><p className="font-display text-3xl font-bold text-[#b85339]">{scoreOf(me)} PT</p><p className="text-[10px] text-[#5f7b83]">企画点 {scoreOf(me) - (me?.scoreBonus ?? 0)} + バフ {me?.scoreBonus ?? 0}</p></div></div><div className="mt-2 flex min-h-[145px] flex-wrap gap-3">{me?.submitted.length ? me.submitted.map((submission) => <SubmittedPile key={submission.id} submission={submission} owner={me} isSelf hasForceBulk={false} />) : <div className="grid w-full place-items-center rounded border border-dashed border-[#4f9db0]/50 text-sm text-[#587b83]">手札から企画と素材を選び、ここへ積みます。</div>}</div></article></section><aside className="rounded-lg border border-[#65c6de]/25 bg-[#10262d]/95 p-3 shadow-xl"><div className="flex items-center justify-between"><p className="text-[10px] font-bold tracking-[0.14em] text-[#39bfe8]">AUTO AUCTION</p><span className="h-2 w-2 rounded-full bg-[#57db9f]" title="同期中" /></div>{state.auction ? <section key={`${state.auction.card.id}-${state.auction.highestBid}`} className="balku-auction-bid mt-3 rounded border border-[#f2c94c]/50 bg-[#f2c94c]/10 p-3"><div className="flex items-center gap-2 text-[#f4d873]"><Gavel size={16} /><p className="text-xs font-bold">オークション</p></div><div className="mt-2"><div key={state.auction.card.id} className="balku-card-deal"><CardFace card={state.auction.card} compact /></div></div><p className="mt-2 text-xs text-[#b5ccce]">現在額 <strong className="text-[#f4d873]">{state.auction.highestBid}</strong> coin{auctionSeconds !== null ? <> ・ <strong className={auctionSeconds <= 5 ? "text-[#ff9c93]" : "text-[#f4d873]"}>{auctionSeconds}秒</strong></> : "。決済待ち"}</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={(me?.coins ?? 0) < state.auction.highestBid + 1 || move.isPending || isFinished} onClick={() => apply({ type: "bid", amount: state.auction!.highestBid + 1 })} className="rounded bg-[#f2c94c] px-2 py-2 text-xs font-bold text-[#1d2b2d] disabled:opacity-40">+1 入札</button><button type="button" disabled={(me?.coins ?? 0) < state.auction.highestBid + 2 || move.isPending || isFinished} onClick={() => apply({ type: "bid", amount: state.auction!.highestBid + 2 })} className="rounded border border-[#f2c94c]/60 px-2 py-2 text-xs font-bold text-[#f5d873] disabled:opacity-40">+2 入札</button></div></section> : <section className="mt-3 rounded border border-[#74b0be]/25 bg-black/10 p-3 text-xs leading-5 text-[#a3c0c4]"><Gavel className="mr-2 inline h-4 w-4 text-[#39bfe8]" />次の施工ラウンドでランダムなカードが出品されます。</section>}<div className="mt-3 max-h-[160px] space-y-2 overflow-y-auto pr-1">{state.logs.map((entry) => <p key={entry.id} className={`border-l-2 py-1 pl-3 text-[10px] leading-4 ${entry.tone === "good" ? "border-[#58dba1] text-[#9ee7bf]" : entry.tone === "warning" ? "border-[#f2c94c] text-[#f1d879]" : entry.tone === "danger" ? "border-[#e36a61] text-[#f09a91]" : "border-[#4d7780] text-[#9ab7ba]"}`}>{entry.text}</p>)}</div></aside></section><section id="hand" className="mt-3 rounded-lg border border-[#55bed6]/30 bg-[#0c2027]/95 p-3 shadow-2xl"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[0.14em] text-[#39bfe8]">手札 / HAND</p><p className="mt-1 text-xs text-[#9ab8be]">長押しで詳細を確認。</p></div><button type="button" onClick={() => { setSelectedPlan(null); setSelectedMaterials([]); setSelectedTarget(null); }} className="rounded border border-white/15 p-2 text-[#aac4c8] hover:text-white" title="選択解除"><RotateCcw size={15} /></button></div>{selectedProject && <section onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addBuildMaterial(readDragCard(event)); setDraggingCard(null); }} className="balku-drop-pocket mt-3 rounded border border-[#39bfe8]/65 bg-[#12323b] p-3" data-over={draggingCard !== null}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[0.14em] text-[#80e4f5]">CONSTRUCTION POCKET / 施工ポケット</p><p className="font-bold text-[#f4ead1]">{selectedProject.name} <span className="ml-2 text-xs font-normal text-[#9dbfc4]">{requirements(selectedProject)}</span></p><p className="mt-1 text-xs text-[#a9c4c7]">素材をここへドラッグ、または手札をタップして納品。</p></div><div className="rounded border border-[#39bfe8]/30 bg-black/15 px-3 py-2 text-xs text-[#cbe8eb]">納品素材 {selectedMaterials.length} 枚</div></div>{requiresTarget && <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-[11px] font-bold text-[#f4d873]">対象</span>{opponents.filter((player) => !player.eliminated).map((player) => <button key={player.seat} type="button" onClick={() => setSelectedTarget(player.seat)} className={`rounded px-3 py-1.5 text-xs font-bold ${selectedTarget === player.seat ? "bg-[#f2c94c] text-[#17252a]" : "border border-[#f2c94c]/40 text-[#f5d873]"}`}>{player.name}</button>)}</div>}<div className="mt-3 flex flex-wrap items-center gap-2"><div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); sellCards([readDragCard(event)]); setDraggingCard(null); }} data-card-action="sale-land" className={`balku-drop-pocket flex min-w-[170px] items-center gap-2 rounded border border-[#63d8a2]/60 bg-[#12372b] px-3 py-2 ${saleFlash ? "balku-sale-flash" : ""}`} data-over={draggingCard !== null}><PackageOpen className="h-4 w-4 text-[#86edb5]" /><span className="text-[10px] font-bold text-[#d0f4df]">カードを売却 → +1 coin</span></div><button type="button" disabled={!isTurn || (requiresTarget && selectedTarget === null) || move.isPending} onClick={() => submitProject(true)} className="rounded bg-[#39bfe8] px-3 py-2 text-xs font-bold text-[#10262d] disabled:opacity-40">公開で施工</button><button type="button" disabled={!isTurn || (requiresTarget && selectedTarget === null) || move.isPending} onClick={() => submitProject(false)} className="hazard-button rounded px-3 py-2 text-xs font-bold text-[#182a2e] disabled:opacity-40">伏せて施工</button></div></section>}<div className="mt-3 grid gap-3 xl:grid-cols-2"><div className="min-w-0" aria-label="企画カードのソート済み一覧"><div className="flex gap-3 overflow-x-auto pb-2">{sortedHand.projects.map((card) => <CardFace key={card.id} card={card} selected={card.id === selectedPlan} draggable={isTurn && !me?.actionUsed} onPreview={() => setPreviewCard(card)} onDragStart={startCardDrag(card)} onDragEnd={() => setDraggingCard(null)} onClick={() => toggleCard(card)} />)}</div></div><div className="min-w-0" aria-label="素材カード一覧"><div className="flex gap-3 overflow-x-auto pb-2">{sortedHand.materials.map((card) => <CardFace key={card.id} card={card} selected={selectedMaterials.includes(card.id)} draggable={isTurn && !me?.actionUsed} onPreview={() => setPreviewCard(card)} onDragStart={startCardDrag(card)} onDragEnd={() => setDraggingCard(null)} onClick={() => { if (selectedProject) addBuildMaterial(card.id); else toggleCard(card); }} />)}</div></div></div></section></div><section className="mt-3 flex flex-wrap items-center justify-end gap-3 rounded-lg border border-[#67cde0]/35 bg-[#10262d]/95 p-3 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur"><div className="flex flex-wrap items-center justify-end gap-2"><button type="button" disabled={!isTurn || Boolean(me?.actionUsed) || move.isPending || isFinished} onClick={() => apply({ type: "endTurn" })} className="rounded border border-[#65c6de]/50 px-3 py-2 text-xs font-bold text-[#9fe4f4] disabled:opacity-40">パス <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button></div></section><Sheet open={shopOpen} onOpenChange={setShopOpen}><SheetContent side="right" className="border-[#f2c94c]/45 bg-[#10262d] text-[#edf0e4] sm:max-w-md"><SheetHeader><SheetTitle className="font-display text-3xl text-[#f4ead1]">ショップ</SheetTitle><SheetDescription className="text-[#a9c3c7]">自身のターンの時にコインを消費して素材を購入できます。</SheetDescription></SheetHeader><div className="px-4"><p className="rounded bg-[#f2c94c]/10 px-3 py-2 text-xs font-bold text-[#f5db80]">所持 {me?.coins ?? 0} coins</p><div className="mt-4 grid gap-2">{MARKET.map(({ material, price }) => <button key={material} type="button" disabled={!isTurn || Boolean(me?.actionUsed) || (me?.coins ?? 0) < price || move.isPending || isFinished} onClick={() => { apply({ type: "buyMaterial", material }); setShopOpen(false); }} className={`flex items-center justify-between rounded border px-4 py-3 text-left transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35 ${MATERIAL_STYLE[material]}`}><span className="font-bold">{material}{material === "超伝導体" && <span className="ml-1 text-[9px]">RARE</span>}</span><span className="text-xs opacity-75">{price} coins</span></button>)}</div></div></SheetContent></Sheet><CardPreview card={previewCard} open={Boolean(previewCard)} onOpenChange={(open) => { if (!open) setPreviewCard(null); }} onSell={isTurn && !me?.actionUsed && !isFinished ? (card) => { sellCards([card.id]); setPreviewCard(null); } : undefined} />{isFinished && <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-[#061217]/80 p-5 backdrop-blur-sm"><section className="balku-result-panel my-8 w-full max-w-lg rounded-xl border border-[#39bfe8]/70 bg-[#102d35] p-7 text-center shadow-2xl"><Check className="mx-auto h-12 w-12 text-[#68e0a7]" /><p className="mt-4 text-xs font-bold tracking-[0.16em] text-[#39bfe8]">DECK EXHAUSTED / FINAL SETTLEMENT</p><h2 className="mt-3 font-display text-5xl font-bold text-[#f4ead1]">{sharedWin && ownWins ? "共同勝利" : ownWins ? "勝利" : "対戦終了"}</h2><p className="mt-3 text-sm leading-6 text-[#b5c7c9]">山札が尽き、提出企画とバフの合計ポイントを精算しました。</p><div className="mt-6 space-y-2 text-left">{finalScores.map((score, index) => <div key={score.seat} className={`balku-result-row flex items-center justify-between rounded border px-4 py-3 ${winningSeats.includes(score.seat) ? "border-[#f2c94c]/70 bg-[#f2c94c]/10" : "border-white/10 bg-black/10"}`} style={{ animationDelay: `${index * 90}ms` }}><div><p className="text-sm font-bold">{index + 1}. {score.name}</p><p className="mt-0.5 text-[10px] text-[#9bbabd]">企画 {score.submittedPoints} PT + バフ {score.bonusPoints} PT</p></div><strong className="font-display text-2xl text-[#f4d873]">{score.points} PT</strong></div>)}</div>{data.player.isHost ? <button type="button" disabled={restart.isPending} onClick={() => restart.mutate({ code: session.code, playerToken: session.playerToken, expectedRevision: data.revision })} className="mt-7 rounded bg-[#39bfe8] px-5 py-3 text-sm font-bold text-[#10272d] disabled:opacity-50">同じ現場で再戦する</button> : <p className="mt-7 rounded border border-[#39bfe8]/30 bg-[#39bfe8]/10 px-4 py-3 text-sm text-[#9fe0ef]">作成者が再戦を準備するのを待っています。</p>}<button type="button" onClick={leave} className="mt-3 rounded border border-white/20 px-5 py-3 text-sm font-bold text-[#d9e4e3]">新しい現場へ</button></section></div>}{tutorial && <Tutorial onClose={closeTutorial} />}</main>;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(readSession);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }, [session]);

  const enter = (next: Session) => {
    window.history.replaceState({}, "", `/?room=${next.code}`);
    setSession(next);
  };

  const leave = () => {
    if (session) {
      utils.balku.leaveRoom.mutate({ code: session.code, playerToken: session.playerToken }).catch(() => {});
    }
    window.sessionStorage.removeItem(SESSION_KEY);
    window.history.replaceState({}, "", "/");
    setSession(null);
  };

  return session ? <OnlineRoom session={session} leave={leave} /> : <Lobby onSession={enter} />;
}