import React, { useEffect, useState } from 'react'
import { useSessionStore } from './store/sessionStore'
import DropZone from './components/DropZone'
import ProcessingScreen from './components/ProcessingScreen'
import EntityReview from './components/EntityReview'
import SuccessScreen from './components/SuccessScreen'
import BatchProcessingScreen from './components/BatchProcessingScreen'
import BatchReview from './components/BatchReview'
import BatchSuccessScreen from './components/BatchSuccessScreen'
import ErrorOverlay from './components/ErrorOverlay'
import SettingsScreen from './components/SettingsScreen'

export default function App(): React.JSX.Element {
  const { screen, setProgress } = useSessionStore()
  const [showSettings, setShowSettings] = useState(false)
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark')

  function toggleDark(): void {
    const next = !isDark
    setIsDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }

  // Registra il listener globale per i progressi una sola volta al mount
  useEffect(() => {
    const remove = window.electronAPI.onProgress(({ percent, message }) => {
      setProgress(percent, message)
    })
    return remove
  }, [setProgress])

  if (showSettings) {
    return <SettingsScreen onBack={() => setShowSettings(false)} isDark={isDark} onToggleDark={toggleDark} />
  }

  return (
    <>
      {screen === 'dropzone'         && <DropZone onOpenSettings={() => setShowSettings(true)} isDark={isDark} onToggleDark={toggleDark} />}
      {screen === 'processing'       && <ProcessingScreen />}
      {screen === 'review'           && <EntityReview />}
      {screen === 'success'          && <SuccessScreen />}
      {screen === 'batch-processing' && <BatchProcessingScreen />}
      {screen === 'batch-review'     && <BatchReview />}
      {screen === 'batch-success'    && <BatchSuccessScreen />}
      <ErrorOverlay />
    </>
  )
}
