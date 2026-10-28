const KEY = "vr4.training";
const OLD_KEY = "vr4.sessions"; // ancien format à plusieurs entraînements

export function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.series)) return data;
    // reprise de l'entraînement courant de l'ancien format
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    const s = old?.sessions?.find((x) => x.id === old.currentId) ?? old?.sessions?.[0];
    if (s && Array.isArray(s.series)) return { series: s.series };
  } catch {
    // données corrompues : on repart de zéro
  }
  return { series: [] };
}

export function save(training) {
  localStorage.setItem(KEY, JSON.stringify(training));
}

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
