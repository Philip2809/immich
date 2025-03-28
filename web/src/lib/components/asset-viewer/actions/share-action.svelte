<script lang="ts">
  import CircleIconButton from '$lib/components/elements/buttons/circle-icon-button.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/menu-option.svelte';
  import CreateSharedLinkModal from '$lib/components/shared-components/create-share-link-modal/create-shared-link-modal.svelte';
  import Portal from '$lib/components/shared-components/portal/portal.svelte';
  import type { AssetResponseDto } from '@immich/sdk';
  import { mdiShareVariantOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
    menuItem?: boolean;
  }

  let { asset, menuItem }: Props = $props();

  let showModal = $state(false);
</script>

{#if menuItem}
  <MenuOption text={$t('share')} icon={mdiShareVariantOutline} onClick={() => (showModal = true)} />
{:else}
  <CircleIconButton
    title={$t('share')}
    icon={mdiShareVariantOutline}
    onclick={() => (showModal = true)}
    color="opaque"
  />
{/if}

{#if showModal}
  <Portal target="body">
    <CreateSharedLinkModal assetIds={[asset.id]} onClose={() => (showModal = false)} />
  </Portal>
{/if}
