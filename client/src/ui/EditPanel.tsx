import type { Photo } from '../state/photoStore.ts';
import { HistogramView } from './panels/HistogramView.tsx';
import { LightPanel, WhiteBalancePanel } from './panels/LightPanel.tsx';
import { CurvePanel } from './panels/CurvePanel.tsx';
import { ColorPanel } from './panels/ColorPanel.tsx';
import { DetailPanel } from './panels/DetailPanel.tsx';
import { GeometryPanel } from './panels/GeometryPanel.tsx';
import { InfoPanel } from './InfoPanel.tsx';
import { Section } from './controls/Section.tsx';

export function EditPanel({ photo }: { photo: Photo }) {
  return (
    <div className="edit-panel">
      <HistogramView />
      <WhiteBalancePanel photoId={photo.id} />
      <LightPanel photoId={photo.id} />
      <ColorPanel photoId={photo.id} />
      <CurvePanel photoId={photo.id} />
      <DetailPanel photoId={photo.id} />
      <GeometryPanel photoId={photo.id} />
      <Section title="Info" defaultOpen={false}>
        <InfoPanel photo={photo} />
      </Section>
    </div>
  );
}
