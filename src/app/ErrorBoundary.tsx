import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { fehler: Error | null }

/**
 * Fängt Fehler ab, die sonst einen weißen Bildschirm hinterlassen.
 *
 * Die Meldung nennt keine technischen Einzelheiten: Sie steht vor jemandem, der
 * gerade einen Angehörigen verloren hat, und ein Stacktrace hilft dieser Person
 * nicht. In die Konsole geht er trotzdem.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { fehler: null }

  static getDerivedStateFromError(fehler: Error): State {
    return { fehler }
  }

  override componentDidCatch(fehler: Error, info: ErrorInfo) {
    console.error('Unbehandelter Fehler in der Oberfläche:', fehler, info.componentStack)
  }

  override render() {
    if (this.state.fehler === null) {
      return this.props.children
    }

    return (
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 'var(--dichte-abstand)',
          padding: 'var(--dichte-abstand-gross) var(--dichte-abstand)',
        }}
      >
        <h1>Da ist etwas schiefgegangen</h1>
        <p style={{ color: 'var(--farbe-text-sekundaer)' }}>
          Bitte laden Sie die Seite neu. Ihre Daten sind davon nicht betroffen.
        </p>
      </main>
    )
  }
}
