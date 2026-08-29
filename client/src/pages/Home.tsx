import { type DragEvent, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, BookOpen, Check, CircleDot, Clock3, Coins, Copy, Gavel, Globe, Hammer, LogOut, PackageOpen, Play, Plus, RotateCcw, ShieldAlert, ShoppingBag, Sparkles, Users, Volume2, VolumeX, X, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { sortHandCards } from "@/lib/handSort";
import { Sound } from "@/lib/sound";
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
type CutIn = { logId: string; eyebrow: string; title: string; detail: string; tone: "good" | "warning" | "danger"; marker: "build" | "inspect" | "market" | "final" | "eliminate" };

const MATERIAL_STYLE: Record<string, string> = {
  木材: "border-orange-300/70 bg-orange-950/50 text-orange-200 material-glow-木材",
  鉄骨: "border-slate-300/50 bg-slate-800/80 text-slate-100 material-glow-鉄骨",
  コンクリート: "border-stone-300/50 bg-stone-700/80 text-stone-100 material-glow-コンクリート",
  ガラス: "border-cyan-300/70 bg-cyan-950/55 text-cyan-100 material-glow-ガラス",
  銅線: "border-amber-400/60 bg-amber-950/50 text-amber-100 material-glow-銅線",
  合金: "border-violet-300/70 bg-violet-950/55 text-violet-100 material-glow-合金",
  超伝導体: "border-fuchsia-300 bg-gradient-to-br from-fuchsia-950 to-indigo-950 text-fuchsia-100 material-glow-超伝導体",
  ゴミ: "border-gray-400/50 bg-gray-700/60 text-gray-200 material-glow-ゴミ",
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
const SOUND_MUTE_KEY = "balku-sound-muted";

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
  if (detail.includes("脱落")) return { ...base, eyebrow: "COMPANY DOWN", title: "施工者脱落", tone: "danger", marker: "eliminate" };
  return null;
}

function GameCutIn({ cutIn }: { cutIn: CutIn }) {
  const theme = cutIn.tone === "danger" ? "border-[#ef756c] bg-[#35191d] text-[#ffd5d0]" : cutIn.tone === "warning" ? "border-[#f2c94c] bg-[#3b3218] text-[#fff0b1]" : "border-[#57dba0] bg-[#12362e] text-[#d5ffe6]";
  const Marker = cutIn.marker === "inspect" ? ShieldAlert : cutIn.marker === "market" ? Gavel : cutIn.marker === "final" ? Check : cutIn.marker === "eliminate" ? AlertTriangle : Hammer;
  return <div className="pointer-events-none fixed inset-x-0 top-5 z-[70] flex justify-center px-4" role="status" aria-live="polite"><section className={`balku-cutin relative w-full max-w-xl overflow-hidden border px-5 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.52)] ${theme}`}><div className="absolute inset-0 blueprint-grid opacity-20" /><div className="balku-cutin-tape absolute inset-x-0 top-0 h-1.5" /><div className="relative flex items-center gap-4"><div className="grid h-11 w-11 shrink-0 place-items-center border border-current/50 bg-black/15"><Marker size={23} /></div><div className="min-w-0"><p className="text-[9px] font-bold tracking-[0.2em] opacity-70">{cutIn.eyebrow}</p><h2 className="mt-0.5 font-display text-3xl font-bold leading-none tracking-wide">{cutIn.title}</h2><p className="mt-1 line-clamp-1 text-xs font-medium opacity-85">{cutIn.detail}</p></div></div></section></div>;
}

function CardFace({ card, selected = false, onClick, onPreview, onDragStart, onDragEnd, compact = false, draggable = false, animating = false }: { card: Card; selected?: boolean; onClick?: () => void; onPreview?: () => void; onDragStart?: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd?: () => void; compact?: boolean; draggable?: boolean; animating?: boolean }) {
  const longPressTimer = useRef<number | null>(null); const previewed = useRef(false);
  const clearLongPress = () => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current); longPressTimer.current = null; };
  const startLongPress = () => { if (!onPreview) return; previewed.current = false; longPressTimer.current = window.setTimeout(() => { previewed.current = true; onPreview(); }, 460); };
  const materialClass = card.kind === "material" ? MATERIAL_STYLE[card.material ?? ""] ?? "border-slate-500 bg-slate-900 text-white" : "border-[#c6af80] bg-[#f1e6cc] text-[#182830]";
  const animClass = animating ? "balku-card-flip" : "balku-card-action";
  return <button type="button" draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onPointerDown={startLongPress} onPointerUp={clearLongPress} onPointerCancel={clearLongPress} onPointerLeave={clearLongPress} onKeyDown={(event) => { if (event.key === " " && onPreview) { event.preventDefault(); onPreview(); } }} onClick={() => { if (previewed.current) { previewed.current = false; return; } onClick?.(); }} data-card-action="hand-arrival" className={`${animClass} group relative flex shrink-0 flex-col overflow-hidden rounded-md border text-left shadow-[0_9px_16px_rgba(0,0,0,0.25)] transition duration-150 hover:-translate-y-1 hover:shadow-[0_16px_22px_rgba(0,0,0,0.34)] active:scale-[0.98] ${compact ? "h-[106px] w-[118px] p-2" : "h-[151px] w-[132px] p-3"} ${materialClass} ${selected ? "ring-3 ring-[#f2c94c] ring-offset-2 ring-offset-[#10232a] card-select-ring" : ""}`} aria-pressed={selected} aria-label={`${card.name}${onPreview ? "。長押しまたはスペースキーで詳細" : ""}`}>
    <span className={`absolute inset-x-0 top-0 h-1 ${card.kind === "project" ? "bg-[#39bfe8]" : "bg-current opacity-60"}`} />
    {card.rarity === "premium" && <span className="absolute right-2 top-2 rounded bg-fuchsia-300/20 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-fuchsia-100">PREMIUM</span>}
    <span className="mt-1 text-[9px] font-bold tracking-[0.11em] opacity-75">{card.kind === "project" ? card.immediate ? "即時企画 / PLAN" : "素材企画 / PLAN" : `素材 / ${card.rarity === "premium" ? "RARE" : "MATERIAL"}`}</span>
    <span className={`${compact ? "mt-2 text-[15px]" : "mt-3 text-[18px]"} font-bold leading-tight`}>{card.name}</span>
    {card.kind === "project" ? <><span className="mt-2 text-[10px] leading-snug opacity-70">{requirements(card)}</span><span className="mt-auto flex items-end justify-between gap-1 text-xs font-bold text-[#1b5b6f]"><span>{card.effect?.label}</span><span className="font-display text-[22px] text-[#bc5c43]">{card.points} PT</span></span></> : <><span className="mt-3 text-xs opacity-65">資材区分</span><span className="text-sm font-bold">{card.material}</span><span className="mt-auto text-[11px] font-bold opacity-70">施工・売却に使える</span></>}
  </button>;
}

function CardPreview({ card, open, onOpenChange, onSell }: { card: Card | null; open: boolean; onOpenChange: (open: boolean) => void; onSell?: (card: Card) => void }) {
  if (!card) return null;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md border-[#39bfe8]/60 bg-[#10262d] text-[#edf0e4]"><DialogHeader><DialogTitle className="font-display text-3xl tracking-wide">カード詳細</DialogTitle><DialogDescription className="text-[#a9c3c7]">長押し、またはスペースキーで開けます。</DialogDescription></DialogHeader><div className="mx-auto py-2"><CardFace card={card} compact /></div><div className="rounded border border-[#55bed6]/30 bg-[#091a20] p-4 text-sm leading-6"><p className="font-bold text-[#f4ead1]">{card.name}</p><p className="mt-2 text-[#b4cbce]">{card.kind === "project" ? `${requirements(card)} / ${card.effect?.label ?? "効果なし"} / ${card.points ?? 0} PT` : `資材区分：${card.material}${card.rarity === "premium" ? "（高級素材）" : ""}`}</p></div>{onSell && <button type="button" onClick={() => onSell(card)} className="mt-3 w-full rounded border border-[#63d8a2]/60 bg-[#2f9e6d] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#3cb87d] active:scale-[0.98]">カードを売却 +1 coin</button>}</DialogContent></Dialog>;
}

function SubmittedPile({ submission, owner, isSelf, onBulk, onForceBulk, hasForceBulk, animating }: { submission: Submission; owner: Player; isSelf: boolean; onBulk?: () => void; onForceBulk?: () => void; hasForceBulk: boolean; animating?: boolean }) {
  const hidden = !submission.faceUp && !isSelf;
  const canBulk = !isSelf && !owner.eliminated && (!submission.faceUp || !submission.effectActivated);
  const animClass = animating ? "balku-card-shake" : "balku-pile-enter";
  return <div data-card-action="construction-land" className={`${animClass} relative w-[146px] ${hidden ? "hazard-card" : ""}`}><div className="absolute inset-x-2 top-[10px] h-[100px] rounded border border-[#9d7344] bg-[#9b633e] shadow-sm" /><div className={`relative min-h-[120px] rounded border-2 p-3 shadow-lg ${hidden ? "border-[#f2c94c] bg-[#182930] text-[#f4ead1]" : submission.legal ? "border-[#2698b5] bg-[#f2e6cc] text-[#1d3138]" : "border-[#e36a61] bg-[#f5dfd5] text-[#2f2020]"}`}><p className={`text-[9px] font-bold tracking-[0.1em] ${hidden ? "text-[#f2c94c]" : submission.legal ? "text-[#24677d]" : "text-red-600"}`}>{hidden ? "非開示企画 / HIDDEN" : submission.legal ? "承認済み / APPROVED" : "違法疑義 / RISK"}</p><p className="mt-2 text-[15px] font-bold leading-tight">{hidden ? "企画書 — 非開示" : submission.project.name}</p><p className="mt-3 text-[10px] opacity-70">添付素材 {submission.materialCount} 枚</p>{!hidden && <p className="mt-1 font-display text-[22px] font-bold text-[#b95037]">{submission.project.points} PT</p>}{canBulk && <div className="mt-3 grid gap-1.5"><button type="button" onClick={onBulk} className="balku-hover-lift w-full rounded bg-[#f2c94c] px-2 py-1.5 text-[11px] font-bold text-[#172329] transition active:scale-95">BALKU</button>{hasForceBulk && <button type="button" onClick={onForceBulk} className="balku-hover-lift w-full rounded bg-[#dd5a51] px-2 py-1.5 text-[10px] font-bold text-white transition active:scale-95">確定BALKU</button>}</div>}</div></div>;
}

function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const slides = [
    { eyebrow: "01 / 入室", title: "チュートリアルを閉じると\nゲームが開始されます。", body: "このゲームは企画を完成させポイントを稼ぐゲームです。素材を集め、企画書を積み、疑わしければ検査を仕掛けましょう。" },
    { eyebrow: "02 / 施工", title: "企画を置き、\n素材を納める。", body: "自身のターンに任意の企画カードを選び、対応する素材を選択します。素材が足りなくても企画は完成しますが、違法建築となります。" },
    { eyebrow: "03 / 違法建築", title: "企画カードに書かれていない素材も企画カードに使えます。\nこれを違法建築と言います\n表向きで提出した場合違法建築とみなされますが、\n裏向きで提出すれば違法建築とみなされません。", body: "主なアクション\n・カードを選択\n・企画を納品\n・右上のショップから任意の素材を購入\n・オークションにコインを入札\n・カードを長押しで売却" },
    { eyebrow: "04 / BALKU", title: "伏せた企画あるいは違法建築をBALKUする事ができます。", body: "BALKUの対象が違法建築である場合はその企画カードと素材カードを押収できます。\n違法建築でない場合は対象企画のポイントあるいはそれ以上のポイントを自身の手札の企画からロストされます。\n捨てられる企画がない場合ゲームオーバーとなります。" },
    { eyebrow: "05 / 精算", title: "勝利条件", body: "合計ポイントで順位が決定します。山札が尽きると最終精算が行われ、提出企画のポイントとバフの合計で勝敗を分けます。" }
  ];
  const slide = slides[step];
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-[#07151b]/90 px-5 backdrop-blur-sm"><section className="relative w-full max-w-lg overflow-hidden rounded-xl border border-[#39bfe8]/50 bg-[#10252d] shadow-2xl"><div className="blueprint-grid absolute inset-0 opacity-35" /><div className="relative p-7 sm:p-10"><p className="text-xs font-bold tracking-[0.18em] text-[#39bfe8]">{slide.eyebrow}</p><h2 className="mt-4 whitespace-pre-line font-display text-4xl font-bold leading-[0.92] text-[#f4ead1] sm:text-5xl">{slide.title}</h2><p className="mt-6 max-w-md leading-7 text-[#b7c7c8]">{slide.body}</p><div className="mt-10 flex items-center justify-between gap-4"><div className="flex gap-1.5">{slides.map((_, index) => <span key={index} className={`h-1.5 w-7 rounded transition-colors ${index === step ? "bg-[#39bfe8]" : "bg-white/20"}`} />)}</div><button type="button" onClick={() => step === slides.length - 1 ? onClose() : setStep(step + 1)} className="rounded bg-[#f2c94c] px-5 py-3 text-sm font-bold text-[#16262b] transition hover:bg-[#ffdb67] active:scale-95">{step === slides.length - 1 ? "盤面へ進む" : "次へ"}</button></div><button type="button" onClick={onClose} className="absolute right-4 top-4 rounded p-2 text-[#9eb2b5] hover:bg-white/10 hover:text-white" aria-label="チュートリアルを閉じる"><X size={20} /></button></div></section></div>;
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

  const createRoom = trpc.balku.createRoom.useMutation({
    onSuccess: onSession,
    onError: (error) => toast.error(error.message),
  });
  const joinRoom = trpc.balku.joinRoom.useMutation({
    onSuccess: onSession,
    onError: (error) => toast.error(error.message),
  });
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
            <button type="button" onClick={() => setShowTutorial(true)} className="rounded border border-[#39bfe8]/45 bg-[#102b33]/80 px-3 py-2 text-xs font-bold text-[#91e2f4] transition hover:bg-[#39bfe8]/15">
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
                className="mt-2 w-full rounded border border-[#6ea6b1]/40 bg-[#08171c] px-4 py-3 text-[#f4ead1] outline-none placeholder:text-[#587176] focus:border-[#39bfe8] transition"
              />

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setMaxPlayers(count)}
                    className={`rounded border px-3 py-2 text-sm font-bold transition ${maxPlayers === count ? "border-[#39bfe8] bg-[#39bfe8]/15 text-[#8be0f8]" : "border-white/10 text-[#90a8ab] hover:border-white/25"}`}
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
                className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-[#39bfe8] px-4 py-3.5 font-bold text-[#0b2027] disabled:cursor-not-allowed disabled:opacity-40 transition hover:brightness-110 active:scale-[0.98]"
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
                className="mb-4 flex w-full items-center justify-center gap-2 rounded border border-[#39bfe8]/50 bg-[#39bfe8]/10 px-4 py-2.5 text-sm font-bold text-[#8fe0f8] transition hover:bg-[#39bfe8]/20"
              >
                <Globe size={16} />公開ルーム一覧を見る
              </button>

              <div className="flex gap-2">
                <input
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6))}
                  placeholder="ルームコード 6文字"
                  className="min-w-0 flex-1 rounded border border-[#6ea6b1]/40 bg-[#08171c] px-4 py-3 font-mono tracking-[0.13em] text-[#f4ead1] outline-none transition focus:border-[#39bfe8]"
                />
                <button
                  type="button"
                  disabled={busy || !name.trim() || roomCode.length !== 6}
                  onClick={() => joinRoom.mutate({ code: roomCode, displayName: name })}
                  className="rounded bg-[#f2c94c] px-4 font-bold text-[#15262a] disabled:cursor-not-allowed disabled:opacity-40 transition hover:brightness-110 active:scale-95"
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
                  className="flex items-center justify-between rounded border border-white/10 bg-[#08171c] p-3 text-sm transition hover:border-white/20"
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
                    className="rounded bg-[#f2c94c] px-3 py-1.5 text-xs font-bold text-[#15262a] disabled:opacity-40 transition hover:brightness-110 active:scale-95"
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
