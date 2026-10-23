import { api } from "./api";
import { useStore } from "./store";

/** Imports local audio files/folders into the library with progress toasts. */
export async function importPaths(paths: string[]) {
  const { showToast } = useStore.getState();
  if (!paths.length) return;
  showToast("음악 파일을 가져오는 중…");
  try {
    const n = await api.importFiles(paths);
    showToast(n ? `${n}곡을 라이브러리에 추가했어요` : "가져올 수 있는 오디오 파일이 없어요");
  } catch (e) {
    showToast(`가져오기 실패: ${String(e).slice(0, 80)}`);
  }
}
