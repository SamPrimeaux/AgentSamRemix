import { Composition } from 'remotion';
import { MovieModeComposition } from '../moviemode/MovieModeComposition';

export const RemotionRoot = () => (
  <Composition
    id="MovieModeComposition"
    component={MovieModeComposition}
    durationInFrames={300}
    fps={30}
    width={1280}
    height={720}
    defaultProps={{
      clips: [],
      overlays: [],
      fps: 30,
      width: 1280,
      height: 720,
    }}
  />
);
