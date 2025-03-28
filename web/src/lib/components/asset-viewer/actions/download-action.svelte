<script lang="ts">
  import { shortcut } from '$lib/actions/shortcut';
  import CircleIconButton from '$lib/components/elements/buttons/circle-icon-button.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/menu-option.svelte';
  import { downloadArchive, downloadFile } from '$lib/utils/asset-utils';
  import type { AssetResponseDto } from '@immich/sdk';
  import { mdiFileDownloadOutline, mdiFolderDownloadOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { shortcutLabel as computeShortcutLabel } from '$lib/actions/shortcut';
  import { getAssetControlContext } from '$lib/components/photos-page/asset-select-control-bar.svelte';

  interface Props {
    useContext?: boolean;
    asset?: AssetResponseDto;
    menuItem?: boolean;
    filename?: string;
  }

  let { useContext = true, asset, menuItem = false, filename = 'immich.zip' }: Props = $props();

  let getAssets: (() => AssetResponseDto[]) | undefined;
  let clearSelect: (() => void) | undefined;

  if (useContext) {
    ({ getAssets, clearSelect } = getAssetControlContext());
  }

  const onDownloadFile = async () => {
    // Download via context
    if (getAssets && clearSelect) {
      const assets = [...getAssets()];
      if (assets.length === 1) {
        clearSelect?.();
        downloadFile(assets[0]);
        return;
      }

      clearSelect();
      await downloadArchive(filename, { assetIds: assets.map((asset) => asset.id) });
    } else if (asset) {
      // Download via asset
      await downloadFile(asset);
    }
  };

  let menuItemIcon = $derived(
    getAssets ? (getAssets().length === 1 ? mdiFileDownloadOutline : mdiFolderDownloadOutline) : mdiFileDownloadOutline,
  );
</script>

<svelte:window use:shortcut={{ shortcut: { key: 'd', shift: true }, onShortcut: onDownloadFile }} />

{#if menuItem}
  <MenuOption
    icon={menuItemIcon}
    text={$t('download')}
    onClick={onDownloadFile}
    shortcutLabel={computeShortcutLabel({ key: 'd', shift: true })}
  />
{:else}
  <CircleIconButton color="opaque" icon={mdiFileDownloadOutline} title={$t('download')} onclick={onDownloadFile} />
{/if}
