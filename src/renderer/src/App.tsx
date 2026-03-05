import React, { useEffect } from 'react'
import { useSessionStore } from './store/sessionStore'
import DropZone from './components/DropZone'
import ProcessingScreen from './components/ProcessingScreen'
import EntityReview from './components/EntityReview'
import SuccessScreen from './components/SuccessScreen'
import ErrorOverlay from './components/ErrorOverlay'

export default function App(): React.JSX.Element {
  const { screen, setProgress } = useSessionStore()

  // Registra il listener globale per i progressi una sola volta al mount
  useEffect(() => {
    const remove = window.electronAPI.onProgress(({ percent, message }) => {
      setProgress(percent, message)
    })
    return remove
  }, [setProgress])

  return (
    <>
      {screen === 'dropzone'   && <DropZone />}
      {screen === 'processing' && <ProcessingScreen />}
      {screen === 'review'     && <EntityReview />}
      {screen === 'success'    && <SuccessScreen />}
      <ErrorOverlay />
    </>
  )
}
