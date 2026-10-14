import WavePlanner from './WavePlanner'
import { ReferenceMotsIdProvider } from '../../context/ReferenceMotsIdContext'
import { MoveGroupsCacheProvider } from '../../context/MoveGroupsCacheContext'

export default function WavePlannerPage() {
  return (
    <ReferenceMotsIdProvider>
      <MoveGroupsCacheProvider>
        <WavePlanner />
      </MoveGroupsCacheProvider>
    </ReferenceMotsIdProvider>
  )
}
