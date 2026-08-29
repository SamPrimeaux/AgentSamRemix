import React from 'react';
import { MeshyToolkitTweaks } from '../../creation-station/MeshyToolkitTweaks';
import { useCreationStation } from '../../creation-station/useCreationStation';
import {
  readStoredStudioSegment,
  persistStudioSegment,
  type StudioSegment,
} from '../../creation-station/meshyToolkitTypes';
import type { useDesignStudioCad } from '../../hooks/useDesignStudioCad';
import type { CustomAsset, GenerationConfig, SceneConfig } from '../../../../types';
import type { SavedSceneRow } from '../../shared/ScenePanel';
import type { CadJobRow } from '../../api';
import type { AgentSamGeneratorKey } from '../../../../utils/agentSamGenerators';

type CadHook = ReturnType<typeof useDesignStudioCad>;

export type CreationPanelEditorProps = {
  cad: CadHook;
  customAssets: CustomAsset[];
  genConfig: GenerationConfig;
  onUpdateGenConfig: (c: Partial<GenerationConfig>) => void;
  sceneConfig: SceneConfig;
  onUpdateSceneConfig: (c: Partial<SceneConfig>) => void;
  sceneName: string;
  onSceneNameChange: (n: string) => void;
  savedScenes: SavedSceneRow[];
  sceneBusy: boolean;
  onSaveScene: () => void;
  onLoadScene: (id: string) => void;
  onSpawnModel: (name: string, url: string, scale: number) => void;
  onSpawnProcedural?: (key: AgentSamGeneratorKey) => void;
  onAddCustomAsset: (name: string, url: string) => void | Promise<void>;
  onRemoveCustomAsset: (id: string) => void | Promise<void>;
  onRefreshUserAssets?: () => void;
  onDeployJob: (job: CadJobRow) => void;
  onImportGlb?: (file: File) => void;
  onExportSceneJson?: () => void;
  onDownloadLatestGlb?: () => void;
  cadJobId?: string | null;
  glbR2Key?: string | null;
  latestGlbUrl?: string | null;
  onOpenOperators: () => void;
};

export function CreationPanelEditor(props: CreationPanelEditorProps) {
  const cs = useCreationStation(props.cad);
  const [studioSegment, setStudioSegment] = React.useState<StudioSegment>(readStoredStudioSegment);

  const onStudioSegment = (s: StudioSegment) => {
    setStudioSegment(s);
    persistStudioSegment(s);
  };

  return (
    <section className="cad-editor cad-editor--creation">
      <div className="cad-editor__head">Creation Station</div>
      <div className="cad-editor__body cad-editor__creation-scroll">
        <MeshyToolkitTweaks
          studioSegment={studioSegment}
          onStudioSegment={onStudioSegment}
          railTool={cs.activeTool}
          cs={cs}
          cad={props.cad}
          genConfig={props.genConfig}
          onUpdateGenConfig={props.onUpdateGenConfig}
          sceneConfig={props.sceneConfig}
          onUpdateSceneConfig={props.onUpdateSceneConfig}
          sceneName={props.sceneName}
          onSceneNameChange={props.onSceneNameChange}
          savedScenes={props.savedScenes}
          sceneBusy={props.sceneBusy}
          onSaveScene={props.onSaveScene}
          onLoadScene={props.onLoadScene}
          cadJobId={props.cadJobId}
          glbR2Key={props.glbR2Key}
          customAssets={props.customAssets}
          onSpawnModel={props.onSpawnModel}
          onSpawnProcedural={props.onSpawnProcedural}
          onAddCustomAsset={props.onAddCustomAsset}
          onRemoveCustomAsset={props.onRemoveCustomAsset}
          onRefreshUserAssets={props.onRefreshUserAssets}
          onDeployJob={props.onDeployJob}
          onImportGlb={props.onImportGlb}
          onExportSceneJson={props.onExportSceneJson}
          onDownloadLatestGlb={props.onDownloadLatestGlb}
          latestGlbUrl={props.latestGlbUrl}
          onCreate={() => void cs.runPreview()}
          onQuickGenerate={props.onOpenOperators}
        />
      </div>
    </section>
  );
}
