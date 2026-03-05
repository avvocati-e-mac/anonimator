import React, { useEffect, useState } from 'react'
import { useSessionStore } from './store/sessionStore'
import DropZone from './components/DropZone'
import ProcessingScreen from './components/ProcessingScreen'
import EntityReview from './components/EntityReview'
import SuccessScreen from './components/SuccessScreen'
import ErrorOverlay from './components/ErrorOverlay'
import SettingsScreen from './components/SettingsScreen'

export default function App(): React.JSX.Element {
  const { screen, setProgress } = useSessionStore()
  const [showSettings, setShowSettings] = useState(false)

  // Registra il listener globale per i progressi una sola volta al mount
  useEffect(() => {
    const remove = window.electronAPI.onProgress(({ percent, message }) => {
      setProgress(percent, message)
    })
    return remove
  }, [setProgress])

  if (showSettings) {
    return <SettingsScreen onBack={() => setShowSettings(false)} />
  }

  return (
    <>
      {screen === 'dropzone'   && <DropZone onOpenSettings={() => setShowSettings(true)} />}
      {screen === 'processing' && <ProcessingScreen />}
      {screen === 'review'     && <EntityReview />}
      {screen === 'success'    && <SuccessScreen />}
      <ErrorOverlay />
    </>
  )
}
