/**
 * Der Fall, in dem sich die angemeldete Person gerade befindet (DESIGN.md §2).
 *
 * In diesem Stand gibt es weder Fallanlage noch Synchronisation, also hat
 * niemand einen Fall: Der Hook meldet `kein-fall`, und §7 sperrt darauf den
 * Rest der App.
 *
 * `laedt` steht schon jetzt in der Union, obwohl es heute nie eintritt. Sobald
 * der Fall aus dem Ciphertext-Cache in IndexedDB kommt (§5), gibt es einen
 * Moment, in dem noch nichts entschieden ist — und in diesem Moment darf die
 * App jemandem mit Fall nicht kurz `KeinFall` zeigen. Die Weiche dafür steht
 * besser von Anfang an, als dass sie später nachgetragen werden muss.
 */

export type FallZustand = { status: 'laedt' } | { status: 'kein-fall' }

export function useCase(): FallZustand {
  return { status: 'kein-fall' }
}
