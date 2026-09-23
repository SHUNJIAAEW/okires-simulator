// 機能フラグ。追加費用オプションの機能は、コードを残したまま既定で非表示にする。
// 有効化: Vercel/ローカルの環境変数 VITE_COMMANDER_ENABLED=1、または URL に ?commander=1 を付ける（デモ用）。
function flag(envKey: string, queryKey: string): boolean {
  const env = (import.meta.env as Record<string, string | undefined>)[envKey];
  if (env === '1' || env === 'true') return true;
  try {
    return new URLSearchParams(window.location.search).get(queryKey) === '1';
  } catch {
    return false;
  }
}

// AI災害司令官（司令官モード・KPIバー・未来予測・AI分析・要支援者指標・判断ログ）
export const COMMANDER_ENABLED = flag('VITE_COMMANDER_ENABLED', 'commander');
