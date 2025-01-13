import { BadRequestException } from '@nestjs/common';
import { Stats } from 'node:fs';
import { defaults, SystemConfig } from 'src/config';
import { mapLibrary } from 'src/dtos/library.dto';
import { UserEntity } from 'src/entities/user.entity';
import { AssetStatus, AssetType, ImmichWorker } from 'src/enum';
import { IAssetRepository } from 'src/interfaces/asset.interface';
import { IConfigRepository } from 'src/interfaces/config.interface';
import { ICronRepository } from 'src/interfaces/cron.interface';
import { IDatabaseRepository } from 'src/interfaces/database.interface';
import {
  IJobRepository,
  ILibraryBulkIdsJob,
  ILibraryFileJob,
  JobName,
  JOBS_LIBRARY_PAGINATION_SIZE,
  JobStatus,
} from 'src/interfaces/job.interface';
import { ILibraryRepository } from 'src/interfaces/library.interface';
import { IStorageRepository } from 'src/interfaces/storage.interface';
import { LibraryService } from 'src/services/library.service';
import { assetStub } from 'test/fixtures/asset.stub';
import { authStub } from 'test/fixtures/auth.stub';
import { libraryStub } from 'test/fixtures/library.stub';
import { systemConfigStub } from 'test/fixtures/system-config.stub';
import { userStub } from 'test/fixtures/user.stub';
import { makeMockWatcher } from 'test/repositories/storage.repository.mock';
import { newTestService } from 'test/utils';
import { Mocked, vitest } from 'vitest';

async function* mockWalk() {
  yield await Promise.resolve(['/data/user1/photo.jpg']);
}

describe(LibraryService.name, () => {
  let sut: LibraryService;

  let assetMock: Mocked<IAssetRepository>;
  let configMock: Mocked<IConfigRepository>;
  let cronMock: Mocked<ICronRepository>;
  let databaseMock: Mocked<IDatabaseRepository>;
  let jobMock: Mocked<IJobRepository>;
  let libraryMock: Mocked<ILibraryRepository>;
  let storageMock: Mocked<IStorageRepository>;

  beforeEach(() => {
    ({ sut, assetMock, configMock, cronMock, databaseMock, jobMock, libraryMock, storageMock } =
      newTestService(LibraryService));

    databaseMock.tryLock.mockResolvedValue(true);
    configMock.getWorker.mockReturnValue(ImmichWorker.MICROSERVICES);
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('onConfigInit', () => {
    it('should init cron job and handle config changes', async () => {
      await sut.onConfigInit({ newConfig: defaults });

      expect(cronMock.create).toHaveBeenCalled();

      await sut.onConfigUpdate({
        oldConfig: defaults,
        newConfig: {
          library: {
            scan: {
              enabled: true,
              cronExpression: '0 1 * * *',
            },
            watch: { enabled: false },
          },
        } as SystemConfig,
      });

      expect(cronMock.update).toHaveBeenCalledWith({ name: 'libraryScan', expression: '0 1 * * *', start: true });
    });

    it('should initialize watcher for all external libraries', async () => {
      libraryMock.getAll.mockResolvedValue([
        libraryStub.externalLibraryWithImportPaths1,
        libraryStub.externalLibraryWithImportPaths2,
      ]);

      libraryMock.get.mockImplementation((id) =>
        Promise.resolve(
          [libraryStub.externalLibraryWithImportPaths1, libraryStub.externalLibraryWithImportPaths2].find(
            (library) => library.id === id,
          ) || null,
        ),
      );

      await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchEnabled as SystemConfig });

      expect(storageMock.watch.mock.calls).toEqual(
        expect.arrayContaining([
          (libraryStub.externalLibrary1.importPaths, expect.anything()),
          (libraryStub.externalLibrary2.importPaths, expect.anything()),
        ]),
      );
    });

    it('should not initialize watcher when watching is disabled', async () => {
      await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchDisabled as SystemConfig });

      expect(storageMock.watch).not.toHaveBeenCalled();
    });

    it('should not initialize watcher when lock is taken', async () => {
      databaseMock.tryLock.mockResolvedValue(false);

      await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchEnabled as SystemConfig });

      expect(storageMock.watch).not.toHaveBeenCalled();
    });

    it('should not initialize library scan cron job when lock is taken', async () => {
      databaseMock.tryLock.mockResolvedValue(false);

      await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchEnabled as SystemConfig });

      expect(cronMock.create).not.toHaveBeenCalled();
    });
  });

  describe('onConfigUpdateEvent', () => {
    beforeEach(async () => {
      databaseMock.tryLock.mockResolvedValue(true);
      await sut.onConfigInit({ newConfig: defaults });
    });

    it('should do nothing if instance does not have the watch lock', async () => {
      databaseMock.tryLock.mockResolvedValue(false);
      await sut.onConfigInit({ newConfig: defaults });
      await sut.onConfigUpdate({ newConfig: systemConfigStub.libraryScan as SystemConfig, oldConfig: defaults });
      expect(cronMock.update).not.toHaveBeenCalled();
    });

    it('should update cron job and enable watching', async () => {
      libraryMock.getAll.mockResolvedValue([]);
      await sut.onConfigUpdate({
        newConfig: systemConfigStub.libraryScanAndWatch as SystemConfig,
        oldConfig: defaults,
      });

      expect(cronMock.update).toHaveBeenCalledWith({
        name: 'libraryScan',
        expression: systemConfigStub.libraryScan.library.scan.cronExpression,
        start: systemConfigStub.libraryScan.library.scan.enabled,
      });
    });

    it('should update cron job and disable watching', async () => {
      libraryMock.getAll.mockResolvedValue([]);
      await sut.onConfigUpdate({
        newConfig: systemConfigStub.libraryScanAndWatch as SystemConfig,
        oldConfig: defaults,
      });
      await sut.onConfigUpdate({
        newConfig: systemConfigStub.libraryScan as SystemConfig,
        oldConfig: defaults,
      });

      expect(cronMock.update).toHaveBeenCalledWith({
        name: 'libraryScan',
        expression: systemConfigStub.libraryScan.library.scan.cronExpression,
        start: systemConfigStub.libraryScan.library.scan.enabled,
      });
    });
  });

  describe('handleQueueSyncFiles', () => {
    it('should queue refresh of a new asset', async () => {
      libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
      storageMock.walk.mockImplementation(mockWalk);
      storageMock.stat.mockResolvedValue({ isDirectory: () => true } as Stats);
      storageMock.checkFileExists.mockResolvedValue(true);
      assetMock.filterNewExternalAssetPaths.mockResolvedValue(['/data/user1/photo.jpg']);

      await sut.handleQueueSyncFiles({ id: libraryStub.externalLibraryWithImportPaths1.id });

      expect(jobMock.queue).toHaveBeenCalledWith({
        name: JobName.LIBRARY_SYNC_FILES,
        data: {
          libraryId: libraryStub.externalLibraryWithImportPaths1.id,
          assetPaths: ['/data/user1/photo.jpg'],
          progressCounter: 1,
        },
      });
    });

    it("should fail when library can't be found", async () => {
      libraryMock.get.mockResolvedValue(null);

      await expect(sut.handleQueueSyncFiles({ id: libraryStub.externalLibrary1.id })).resolves.toBe(JobStatus.SKIPPED);
    });

    it('should ignore import paths that do not exist', async () => {
      storageMock.stat.mockImplementation((path): Promise<Stats> => {
        if (path === libraryStub.externalLibraryWithImportPaths1.importPaths[0]) {
          const error = { code: 'ENOENT' } as any;
          throw error;
        }
        return Promise.resolve({
          isDirectory: () => true,
        } as Stats);
      });

      storageMock.checkFileExists.mockResolvedValue(true);

      libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);

      await sut.handleQueueSyncFiles({ id: libraryStub.externalLibraryWithImportPaths1.id });

      expect(storageMock.walk).toHaveBeenCalledWith({
        pathsToCrawl: [libraryStub.externalLibraryWithImportPaths1.importPaths[1]],
        exclusionPatterns: [],
        includeHidden: false,
        take: JOBS_LIBRARY_PAGINATION_SIZE,
      });
    });
  });

  describe('handleQueueSyncAssets', () => {
    it('should call the offline check', async () => {
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);
      storageMock.walk.mockImplementation(async function* generator() {});
      assetMock.getAll.mockResolvedValue({ items: [assetStub.external], hasNextPage: false });
      assetMock.getAssetCount.mockResolvedValue(1);
      assetMock.detectOfflineExternalAssets.mockResolvedValue({ numUpdatedRows: BigInt(1) });

      const response = await sut.handleQueueSyncAssets({ id: libraryStub.externalLibrary1.id });

      expect(response).toBe(JobStatus.SUCCESS);
      expect(assetMock.detectOfflineExternalAssets).toHaveBeenCalledWith(libraryStub.externalLibrary1);
    });

    it('should skip an empty library', async () => {
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);
      storageMock.walk.mockImplementation(async function* generator() {});
      assetMock.getAll.mockResolvedValue({ items: [assetStub.external], hasNextPage: false });
      assetMock.getAssetCount.mockResolvedValue(0);
      assetMock.detectOfflineExternalAssets.mockResolvedValue({ numUpdatedRows: BigInt(1) });

      const response = await sut.handleQueueSyncAssets({ id: libraryStub.externalLibrary1.id });

      expect(response).toBe(JobStatus.SUCCESS);
      expect(assetMock.detectOfflineExternalAssets).not.toHaveBeenCalled();
    });

    it('should queue asset sync', async () => {
      libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
      storageMock.walk.mockImplementation(async function* generator() {});
      assetMock.getAll.mockResolvedValue({ items: [assetStub.external], hasNextPage: false });
      assetMock.getAssetCount.mockResolvedValue(1);
      assetMock.detectOfflineExternalAssets.mockResolvedValue({ numUpdatedRows: BigInt(0) });
      assetMock.getAllInLibrary.mockResolvedValue({ items: [assetStub.external], hasNextPage: false });

      const response = await sut.handleQueueSyncAssets({ id: libraryStub.externalLibraryWithImportPaths1.id });

      expect(jobMock.queue).toBeCalledWith({
        name: JobName.LIBRARY_SYNC_ASSETS,
        data: {
          libraryId: libraryStub.externalLibraryWithImportPaths1.id,
          importPaths: libraryStub.externalLibraryWithImportPaths1.importPaths,
          exclusionPatterns: libraryStub.externalLibraryWithImportPaths1.exclusionPatterns,
          assetIds: [assetStub.external.id],
          progressCounter: 1,
          totalAssets: 1,
        },
      });

      expect(response).toBe(JobStatus.SUCCESS);
      expect(assetMock.detectOfflineExternalAssets).toHaveBeenCalledWith(libraryStub.externalLibraryWithImportPaths1);
    });

    it("should fail if library can't be found", async () => {
      libraryMock.get.mockResolvedValue(null);

      await expect(sut.handleQueueSyncAssets({ id: libraryStub.externalLibrary1.id })).resolves.toBe(JobStatus.SKIPPED);
    });
  });

  describe('handleSyncAssets', () => {
    it('should offline assets no longer on disk', async () => {
      const mockAssetJob: ILibraryBulkIdsJob = {
        assetIds: [assetStub.external.id],
        libraryId: libraryStub.externalLibrary1.id,
        importPaths: ['/'],
        exclusionPatterns: [],
      };

      assetMock.getByIds.mockResolvedValue([assetStub.external]);
      storageMock.stat.mockRejectedValue(new Error('ENOENT, no such file or directory'));

      await expect(sut.handleSyncAssets(mockAssetJob)).resolves.toBe(JobStatus.SUCCESS);

      expect(assetMock.updateAll).toHaveBeenCalledWith([assetStub.external.id], {
        isOffline: true,
        deletedAt: expect.anything(),
        status: 'trashed',
      });
    });

    it('should set assets deleted from disk as offline', async () => {
      const mockAssetJob: ILibraryBulkIdsJob = {
        assetIds: [assetStub.external.id],
        libraryId: libraryStub.externalLibrary1.id,
        importPaths: ['/data/user2'],
        exclusionPatterns: [],
      };

      assetMock.getByIds.mockResolvedValue([assetStub.external]);
      storageMock.stat.mockRejectedValue(new Error('Could not read file'));

      await expect(sut.handleSyncAssets(mockAssetJob)).resolves.toBe(JobStatus.SUCCESS);

      expect(assetMock.updateAll).toHaveBeenCalledWith([assetStub.external.id], {
        isOffline: true,
        deletedAt: expect.anything(),
        status: AssetStatus.TRASHED,
      });
    });

    it('should do nothing with offline assets deleted from disk', async () => {
      const mockAssetJob: ILibraryBulkIdsJob = {
        assetIds: [assetStub.trashedOffline.id],
        libraryId: libraryStub.externalLibrary1.id,
        importPaths: ['/data/user2'],
        exclusionPatterns: [],
      };

      assetMock.getByIds.mockResolvedValue([assetStub.trashedOffline]);
      storageMock.stat.mockRejectedValue(new Error('Could not read file'));

      await expect(sut.handleSyncAssets(mockAssetJob)).resolves.toBe(JobStatus.SUCCESS);

      expect(assetMock.updateAll).not.toHaveBeenCalled();
    });

    it('should un-trash an asset previously marked as offline', async () => {
      const mockAssetJob: ILibraryBulkIdsJob = {
        assetIds: [assetStub.trashedOffline.id],
        libraryId: libraryStub.externalLibrary1.id,
        importPaths: ['/original/'],
        exclusionPatterns: [],
      };

      assetMock.getByIds.mockResolvedValue([assetStub.trashedOffline]);
      storageMock.stat.mockResolvedValue({ mtime: assetStub.external.fileModifiedAt } as Stats);

      await expect(sut.handleSyncAssets(mockAssetJob)).resolves.toBe(JobStatus.SUCCESS);

      expect(assetMock.updateAll).toHaveBeenCalledWith([assetStub.external.id], {
        isOffline: false,
        deletedAt: null,
        status: AssetStatus.ACTIVE,
      });

      expect(jobMock.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.SIDECAR_DISCOVERY,
          data: {
            id: assetStub.external.id,
            source: 'upload',
          },
        },
      ]);
    });

    it('should do nothing with offline asset if covered by exclusion pattern', async () => {
      const mockAssetJob: ILibraryBulkIdsJob = {
        assetIds: [assetStub.trashedOffline.id],
        libraryId: libraryStub.externalLibrary1.id,
        importPaths: ['/original/'],
        exclusionPatterns: ['**/path.jpg'],
      };

      assetMock.getByIds.mockResolvedValue([assetStub.trashedOffline]);
      storageMock.stat.mockResolvedValue({ mtime: assetStub.external.fileModifiedAt } as Stats);

      await expect(sut.handleSyncAssets(mockAssetJob)).resolves.toBe(JobStatus.SUCCESS);

      expect(assetMock.updateAll).not.toHaveBeenCalled();

      expect(jobMock.queueAll).not.toHaveBeenCalled();
    });

    it('should do nothing with offline asset if not in import path', async () => {
      const mockAssetJob: ILibraryBulkIdsJob = {
        assetIds: [assetStub.trashedOffline.id],
        libraryId: libraryStub.externalLibrary1.id,
        importPaths: ['/import/'],
        exclusionPatterns: [],
      };

      assetMock.getByIds.mockResolvedValue([assetStub.trashedOffline]);
      storageMock.stat.mockResolvedValue({ mtime: assetStub.external.fileModifiedAt } as Stats);

      await expect(sut.handleSyncAssets(mockAssetJob)).resolves.toBe(JobStatus.SUCCESS);

      expect(assetMock.updateAll).not.toHaveBeenCalled();

      expect(jobMock.queueAll).not.toHaveBeenCalled();
    });

    it('should do nothing with unchanged online assets', async () => {
      const mockAssetJob: ILibraryBulkIdsJob = {
        assetIds: [assetStub.external.id],
        libraryId: libraryStub.externalLibrary1.id,
        importPaths: ['/'],
        exclusionPatterns: [],
      };

      assetMock.getByIds.mockResolvedValue([assetStub.external]);
      storageMock.stat.mockResolvedValue({ mtime: assetStub.external.fileModifiedAt } as Stats);

      await expect(sut.handleSyncAssets(mockAssetJob)).resolves.toBe(JobStatus.SUCCESS);

      expect(assetMock.updateAll).not.toHaveBeenCalled();
    });

    it('should update with online assets that have changed', async () => {
      const mockAssetJob: ILibraryBulkIdsJob = {
        assetIds: [assetStub.external.id],
        libraryId: libraryStub.externalLibrary1.id,
        importPaths: ['/'],
        exclusionPatterns: [],
      };

      assetMock.getByIds.mockResolvedValue([assetStub.external]);
      storageMock.stat.mockResolvedValue({ mtime: new Date(assetStub.external.fileModifiedAt.getDate() + 1) } as Stats);

      await expect(sut.handleSyncAssets(mockAssetJob)).resolves.toBe(JobStatus.SUCCESS);

      expect(assetMock.updateAll).not.toHaveBeenCalled();

      expect(jobMock.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.SIDECAR_DISCOVERY,
          data: {
            id: assetStub.external.id,
            source: 'upload',
          },
        },
      ]);
    });
  });

  describe('handleSyncFiles', () => {
    let mockUser: UserEntity;

    beforeEach(() => {
      mockUser = userStub.admin;

      storageMock.stat.mockResolvedValue({
        size: 100,
        mtime: new Date('2023-01-01'),
        ctime: new Date('2023-01-01'),
      } as Stats);
    });

    it('should import a new asset', async () => {
      const mockLibraryJob: ILibraryFileJob = {
        libraryId: libraryStub.externalLibrary1.id,
        assetPaths: ['/data/user1/photo.jpg'],
      };

      assetMock.createAll.mockResolvedValue([assetStub.image]);
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);

      await expect(sut.handleSyncFiles(mockLibraryJob)).resolves.toBe(JobStatus.SUCCESS);

      expect(assetMock.createAll.mock.calls).toEqual([
        [
          [
            expect.objectContaining({
              ownerId: mockUser.id,
              libraryId: libraryStub.externalLibrary1.id,
              originalPath: '/data/user1/photo.jpg',
              deviceId: 'Library Import',
              type: AssetType.IMAGE,
              originalFileName: 'photo.jpg',
              isExternal: true,
            }),
          ],
        ],
      ]);

      expect(jobMock.queueAll.mock.calls).toEqual([
        [
          [
            {
              name: JobName.SIDECAR_DISCOVERY,
              data: {
                id: assetStub.image.id,
                source: 'upload',
              },
            },
          ],
        ],
      ]);
    });

    it('should not import an asset to a soft deleted library', async () => {
      const mockLibraryJob: ILibraryFileJob = {
        libraryId: libraryStub.externalLibrary1.id,
        assetPaths: ['/data/user1/photo.jpg'],
      };

      libraryMock.get.mockResolvedValue({ ...libraryStub.externalLibrary1, deletedAt: new Date() });

      await expect(sut.handleSyncFiles(mockLibraryJob)).resolves.toBe(JobStatus.FAILED);

      expect(assetMock.createAll.mock.calls).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete a library', async () => {
      assetMock.getByLibraryIdAndOriginalPath.mockResolvedValue(assetStub.image);
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);

      await sut.delete(libraryStub.externalLibrary1.id);

      expect(jobMock.queue).toHaveBeenCalledWith({
        name: JobName.LIBRARY_DELETE,
        data: { id: libraryStub.externalLibrary1.id },
      });

      expect(libraryMock.softDelete).toHaveBeenCalledWith(libraryStub.externalLibrary1.id);
    });

    it('should allow an external library to be deleted', async () => {
      assetMock.getByLibraryIdAndOriginalPath.mockResolvedValue(assetStub.image);
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);

      await sut.delete(libraryStub.externalLibrary1.id);

      expect(jobMock.queue).toHaveBeenCalledWith({
        name: JobName.LIBRARY_DELETE,
        data: { id: libraryStub.externalLibrary1.id },
      });

      expect(libraryMock.softDelete).toHaveBeenCalledWith(libraryStub.externalLibrary1.id);
    });

    it('should unwatch an external library when deleted', async () => {
      assetMock.getByLibraryIdAndOriginalPath.mockResolvedValue(assetStub.image);
      libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
      libraryMock.getAll.mockResolvedValue([libraryStub.externalLibraryWithImportPaths1]);

      const mockClose = vitest.fn();
      storageMock.watch.mockImplementation(makeMockWatcher({ close: mockClose }));

      await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchEnabled as SystemConfig });
      await sut.delete(libraryStub.externalLibraryWithImportPaths1.id);

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should return a library', async () => {
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);
      await expect(sut.get(libraryStub.externalLibrary1.id)).resolves.toEqual(
        expect.objectContaining({
          id: libraryStub.externalLibrary1.id,
          name: libraryStub.externalLibrary1.name,
          ownerId: libraryStub.externalLibrary1.ownerId,
        }),
      );

      expect(libraryMock.get).toHaveBeenCalledWith(libraryStub.externalLibrary1.id);
    });

    it('should throw an error when a library is not found', async () => {
      libraryMock.get.mockResolvedValue(null);
      await expect(sut.get(libraryStub.externalLibrary1.id)).rejects.toBeInstanceOf(BadRequestException);
      expect(libraryMock.get).toHaveBeenCalledWith(libraryStub.externalLibrary1.id);
    });
  });

  describe('getStatistics', () => {
    it('should return library statistics', async () => {
      assetMock.getAssetCount.mockResolvedValue(10);
      await expect(sut.getStatistics(libraryStub.externalLibrary1.id)).resolves.toEqual(10);

      expect(assetMock.getAssetCount).toHaveBeenCalledWith({ libraryId: libraryStub.externalLibrary1.id });
    });
  });

  describe('create', () => {
    describe('external library', () => {
      it('should create with default settings', async () => {
        libraryMock.create.mockResolvedValue(libraryStub.externalLibrary1);
        await expect(sut.create({ ownerId: authStub.admin.user.id })).resolves.toEqual(
          expect.objectContaining({
            id: libraryStub.externalLibrary1.id,
            name: libraryStub.externalLibrary1.name,
            ownerId: libraryStub.externalLibrary1.ownerId,
            assetCount: 0,
            importPaths: [],
            exclusionPatterns: [],
            createdAt: libraryStub.externalLibrary1.createdAt,
            updatedAt: libraryStub.externalLibrary1.updatedAt,
            refreshedAt: null,
          }),
        );

        expect(libraryMock.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: expect.any(String),
            importPaths: [],
            exclusionPatterns: expect.any(Array),
          }),
        );
      });

      it('should create with name', async () => {
        libraryMock.create.mockResolvedValue(libraryStub.externalLibrary1);
        await expect(sut.create({ ownerId: authStub.admin.user.id, name: 'My Awesome Library' })).resolves.toEqual(
          expect.objectContaining({
            id: libraryStub.externalLibrary1.id,
            name: libraryStub.externalLibrary1.name,
            ownerId: libraryStub.externalLibrary1.ownerId,
            assetCount: 0,
            importPaths: [],
            exclusionPatterns: [],
            createdAt: libraryStub.externalLibrary1.createdAt,
            updatedAt: libraryStub.externalLibrary1.updatedAt,
            refreshedAt: null,
          }),
        );

        expect(libraryMock.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'My Awesome Library',
            importPaths: [],
            exclusionPatterns: expect.any(Array),
          }),
        );
      });

      it('should create with import paths', async () => {
        libraryMock.create.mockResolvedValue(libraryStub.externalLibrary1);
        await expect(
          sut.create({
            ownerId: authStub.admin.user.id,
            importPaths: ['/data/images', '/data/videos'],
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: libraryStub.externalLibrary1.id,
            name: libraryStub.externalLibrary1.name,
            ownerId: libraryStub.externalLibrary1.ownerId,
            assetCount: 0,
            importPaths: [],
            exclusionPatterns: [],
            createdAt: libraryStub.externalLibrary1.createdAt,
            updatedAt: libraryStub.externalLibrary1.updatedAt,
            refreshedAt: null,
          }),
        );

        expect(libraryMock.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: expect.any(String),
            importPaths: ['/data/images', '/data/videos'],
            exclusionPatterns: expect.any(Array),
          }),
        );
      });

      it('should create watched with import paths', async () => {
        libraryMock.create.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
        libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
        libraryMock.getAll.mockResolvedValue([]);

        await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchEnabled as SystemConfig });
        await sut.create({
          ownerId: authStub.admin.user.id,
          importPaths: libraryStub.externalLibraryWithImportPaths1.importPaths,
        });
      });

      it('should create with exclusion patterns', async () => {
        libraryMock.create.mockResolvedValue(libraryStub.externalLibrary1);
        await expect(
          sut.create({
            ownerId: authStub.admin.user.id,
            exclusionPatterns: ['*.tmp', '*.bak'],
          }),
        ).resolves.toEqual(
          expect.objectContaining({
            id: libraryStub.externalLibrary1.id,
            name: libraryStub.externalLibrary1.name,
            ownerId: libraryStub.externalLibrary1.ownerId,
            assetCount: 0,
            importPaths: [],
            exclusionPatterns: [],
            createdAt: libraryStub.externalLibrary1.createdAt,
            updatedAt: libraryStub.externalLibrary1.updatedAt,
            refreshedAt: null,
          }),
        );

        expect(libraryMock.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: expect.any(String),
            importPaths: [],
            exclusionPatterns: ['*.tmp', '*.bak'],
          }),
        );
      });
    });
  });

  describe('getAll', () => {
    it('should get all libraries', async () => {
      libraryMock.getAll.mockResolvedValue([libraryStub.externalLibrary1]);
      await expect(sut.getAll()).resolves.toEqual([expect.objectContaining({ id: libraryStub.externalLibrary1.id })]);
    });
  });

  describe('handleQueueCleanup', () => {
    it('should queue cleanup jobs', async () => {
      libraryMock.getAllDeleted.mockResolvedValue([libraryStub.externalLibrary1, libraryStub.externalLibrary2]);
      await expect(sut.handleQueueCleanup()).resolves.toBe(JobStatus.SUCCESS);

      expect(jobMock.queueAll).toHaveBeenCalledWith([
        { name: JobName.LIBRARY_DELETE, data: { id: libraryStub.externalLibrary1.id } },
        { name: JobName.LIBRARY_DELETE, data: { id: libraryStub.externalLibrary2.id } },
      ]);
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      libraryMock.getAll.mockResolvedValue([]);

      await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchEnabled as SystemConfig });
    });

    it('should throw an error if an import path is invalid', async () => {
      libraryMock.update.mockResolvedValue(libraryStub.externalLibrary1);
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);

      await expect(sut.update('library-id', { importPaths: ['foo/bar'] })).rejects.toBeInstanceOf(BadRequestException);
      expect(libraryMock.update).not.toHaveBeenCalled();
    });

    it('should update library', async () => {
      libraryMock.update.mockResolvedValue(libraryStub.externalLibrary1);
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);
      storageMock.stat.mockResolvedValue({ isDirectory: () => true } as Stats);
      storageMock.checkFileExists.mockResolvedValue(true);

      const cwd = process.cwd();

      await expect(sut.update('library-id', { importPaths: [`${cwd}/foo/bar`] })).resolves.toEqual(
        mapLibrary(libraryStub.externalLibrary1),
      );
      expect(libraryMock.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'library-id' }));
    });
  });

  describe('onShutdown', () => {
    it('should do nothing if instance does not have the watch lock', async () => {
      await sut.onShutdown();
    });
  });

  describe('watchAll', () => {
    it('should return false if instance does not have the watch lock', async () => {
      await expect(sut.watchAll()).resolves.toBe(false);
    });

    describe('watching disabled', () => {
      beforeEach(async () => {
        await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchDisabled as SystemConfig });
      });

      it('should not watch library', async () => {
        libraryMock.getAll.mockResolvedValue([libraryStub.externalLibraryWithImportPaths1]);

        await sut.watchAll();

        expect(storageMock.watch).not.toHaveBeenCalled();
      });
    });

    describe('watching enabled', () => {
      beforeEach(async () => {
        libraryMock.getAll.mockResolvedValue([]);
        await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchEnabled as SystemConfig });
      });

      it('should watch library', async () => {
        libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
        libraryMock.getAll.mockResolvedValue([libraryStub.externalLibraryWithImportPaths1]);

        await sut.watchAll();

        expect(storageMock.watch).toHaveBeenCalledWith(
          libraryStub.externalLibraryWithImportPaths1.importPaths,
          expect.anything(),
          expect.anything(),
        );
      });

      it('should watch and unwatch library', async () => {
        libraryMock.getAll.mockResolvedValue([libraryStub.externalLibraryWithImportPaths1]);
        libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
        const mockClose = vitest.fn();
        storageMock.watch.mockImplementation(makeMockWatcher({ close: mockClose }));

        await sut.watchAll();
        await sut.unwatch(libraryStub.externalLibraryWithImportPaths1.id);

        expect(mockClose).toHaveBeenCalled();
      });

      it('should not watch library without import paths', async () => {
        libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);
        libraryMock.getAll.mockResolvedValue([libraryStub.externalLibrary1]);

        await sut.watchAll();

        expect(storageMock.watch).not.toHaveBeenCalled();
      });

      it('should handle a new file event', async () => {
        libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
        libraryMock.getAll.mockResolvedValue([libraryStub.externalLibraryWithImportPaths1]);
        assetMock.getByLibraryIdAndOriginalPath.mockResolvedValue(assetStub.image);
        storageMock.watch.mockImplementation(makeMockWatcher({ items: [{ event: 'add', value: '/foo/photo.jpg' }] }));

        await sut.watchAll();

        expect(jobMock.queue).toHaveBeenCalledWith({
          name: JobName.LIBRARY_SYNC_FILES,
          data: {
            libraryId: libraryStub.externalLibraryWithImportPaths1.id,
            assetPaths: ['/foo/photo.jpg'],
          },
        });
      });

      it('should handle a file change event', async () => {
        libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
        libraryMock.getAll.mockResolvedValue([libraryStub.externalLibraryWithImportPaths1]);
        assetMock.getByLibraryIdAndOriginalPath.mockResolvedValue(assetStub.image);
        storageMock.watch.mockImplementation(
          makeMockWatcher({ items: [{ event: 'change', value: '/foo/photo.jpg' }] }),
        );

        await sut.watchAll();

        expect(jobMock.queue).toHaveBeenCalledWith({
          name: JobName.LIBRARY_SYNC_FILES,
          data: {
            libraryId: libraryStub.externalLibraryWithImportPaths1.id,
            assetPaths: ['/foo/photo.jpg'],
          },
        });
      });

      it('should handle a file unlink event', async () => {
        libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
        libraryMock.getAll.mockResolvedValue([libraryStub.externalLibraryWithImportPaths1]);
        assetMock.getByLibraryIdAndOriginalPath.mockResolvedValue(assetStub.image);
        storageMock.watch.mockImplementation(
          makeMockWatcher({ items: [{ event: 'unlink', value: assetStub.image.originalPath }] }),
        );

        await sut.watchAll();

        expect(jobMock.queue).toHaveBeenCalledWith({
          name: JobName.LIBRARY_ASSET_REMOVAL,
          data: {
            libraryId: libraryStub.externalLibraryWithImportPaths1.id,
            assetPaths: [assetStub.image.originalPath],
          },
        });
      });

      it('should handle an error event', async () => {
        libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
        assetMock.getByLibraryIdAndOriginalPath.mockResolvedValue(assetStub.external);
        libraryMock.getAll.mockResolvedValue([libraryStub.externalLibraryWithImportPaths1]);
        storageMock.watch.mockImplementation(
          makeMockWatcher({
            items: [{ event: 'error', value: 'Error!' }],
          }),
        );

        await expect(sut.watchAll()).resolves.toBeUndefined();
      });

      it('should not import a file with unknown extension', async () => {
        libraryMock.get.mockResolvedValue(libraryStub.externalLibraryWithImportPaths1);
        libraryMock.getAll.mockResolvedValue([libraryStub.externalLibraryWithImportPaths1]);
        storageMock.watch.mockImplementation(makeMockWatcher({ items: [{ event: 'add', value: '/foo/photo.xyz' }] }));

        await sut.watchAll();

        expect(jobMock.queue).not.toHaveBeenCalled();
      });

      it('should ignore excluded paths', async () => {
        libraryMock.get.mockResolvedValue(libraryStub.patternPath);
        libraryMock.getAll.mockResolvedValue([libraryStub.patternPath]);
        storageMock.watch.mockImplementation(makeMockWatcher({ items: [{ event: 'add', value: '/dir1/photo.txt' }] }));

        await sut.watchAll();

        expect(jobMock.queue).not.toHaveBeenCalled();
      });

      it('should ignore excluded paths without case sensitivity', async () => {
        libraryMock.get.mockResolvedValue(libraryStub.patternPath);
        libraryMock.getAll.mockResolvedValue([libraryStub.patternPath]);
        storageMock.watch.mockImplementation(makeMockWatcher({ items: [{ event: 'add', value: '/DIR1/photo.txt' }] }));

        await sut.watchAll();

        expect(jobMock.queue).not.toHaveBeenCalled();
      });
    });
  });

  describe('teardown', () => {
    it('should tear down all watchers', async () => {
      libraryMock.getAll.mockResolvedValue([
        libraryStub.externalLibraryWithImportPaths1,
        libraryStub.externalLibraryWithImportPaths2,
      ]);

      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);

      libraryMock.get.mockImplementation((id) =>
        Promise.resolve(
          [libraryStub.externalLibraryWithImportPaths1, libraryStub.externalLibraryWithImportPaths2].find(
            (library) => library.id === id,
          ) || null,
        ),
      );

      const mockClose = vitest.fn();
      storageMock.watch.mockImplementation(makeMockWatcher({ close: mockClose }));

      await sut.onConfigInit({ newConfig: systemConfigStub.libraryWatchEnabled as SystemConfig });
      await sut.onShutdown();

      expect(mockClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleDeleteLibrary', () => {
    it('should delete an empty library', async () => {
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);
      assetMock.getAll.mockResolvedValue({ items: [], hasNextPage: false });

      await expect(sut.handleDeleteLibrary({ id: libraryStub.externalLibrary1.id })).resolves.toBe(JobStatus.SUCCESS);
      expect(libraryMock.delete).toHaveBeenCalled();
    });

    it('should delete all assets in a library', async () => {
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);
      assetMock.getAll.mockResolvedValue({ items: [assetStub.image1], hasNextPage: false });

      assetMock.getById.mockResolvedValue(assetStub.image1);

      await expect(sut.handleDeleteLibrary({ id: libraryStub.externalLibrary1.id })).resolves.toBe(JobStatus.SUCCESS);
    });
  });

  describe('queueScan', () => {
    it('should queue a library scan', async () => {
      libraryMock.get.mockResolvedValue(libraryStub.externalLibrary1);

      await sut.queueScan(libraryStub.externalLibrary1.id);

      expect(jobMock.queue.mock.calls).toEqual([
        [
          {
            name: JobName.LIBRARY_QUEUE_SYNC_FILES,
            data: {
              id: libraryStub.externalLibrary1.id,
            },
          },
        ],
        [
          {
            name: JobName.LIBRARY_QUEUE_SYNC_ASSETS,
            data: {
              id: libraryStub.externalLibrary1.id,
            },
          },
        ],
      ]);
    });
  });

  describe('handleQueueAllScan', () => {
    it('should queue the refresh job', async () => {
      libraryMock.getAll.mockResolvedValue([libraryStub.externalLibrary1]);

      await expect(sut.handleQueueSyncAll()).resolves.toBe(JobStatus.SUCCESS);

      expect(jobMock.queue.mock.calls).toEqual([
        [
          {
            name: JobName.LIBRARY_QUEUE_CLEANUP,
            data: {},
          },
        ],
      ]);
      expect(jobMock.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.LIBRARY_QUEUE_SYNC_FILES,
          data: {
            id: libraryStub.externalLibrary1.id,
          },
        },
      ]);
    });
  });

  describe('validate', () => {
    it('should not require import paths', async () => {
      await expect(sut.validate('library-id', {})).resolves.toEqual({ importPaths: [] });
    });

    it('should validate directory', async () => {
      storageMock.stat.mockResolvedValue({
        isDirectory: () => true,
      } as Stats);

      storageMock.checkFileExists.mockResolvedValue(true);

      await expect(sut.validate('library-id', { importPaths: ['/data/user1/'] })).resolves.toEqual({
        importPaths: [
          {
            importPath: '/data/user1/',
            isValid: true,
            message: undefined,
          },
        ],
      });
    });

    it('should detect when path does not exist', async () => {
      storageMock.stat.mockImplementation(() => {
        const error = { code: 'ENOENT' } as any;
        throw error;
      });

      await expect(sut.validate('library-id', { importPaths: ['/data/user1/'] })).resolves.toEqual({
        importPaths: [
          {
            importPath: '/data/user1/',
            isValid: false,
            message: 'Path does not exist (ENOENT)',
          },
        ],
      });
    });

    it('should detect when path is not a directory', async () => {
      storageMock.stat.mockResolvedValue({
        isDirectory: () => false,
      } as Stats);

      await expect(sut.validate('library-id', { importPaths: ['/data/user1/file'] })).resolves.toEqual({
        importPaths: [
          {
            importPath: '/data/user1/file',
            isValid: false,
            message: 'Not a directory',
          },
        ],
      });
    });

    it('should return an unknown exception from stat', async () => {
      storageMock.stat.mockImplementation(() => {
        throw new Error('Unknown error');
      });

      await expect(sut.validate('library-id', { importPaths: ['/data/user1/'] })).resolves.toEqual({
        importPaths: [
          {
            importPath: '/data/user1/',
            isValid: false,
            message: 'Error: Unknown error',
          },
        ],
      });
    });

    it('should detect when access rights are missing', async () => {
      storageMock.stat.mockResolvedValue({
        isDirectory: () => true,
      } as Stats);

      storageMock.checkFileExists.mockResolvedValue(false);

      await expect(sut.validate('library-id', { importPaths: ['/data/user1/'] })).resolves.toEqual({
        importPaths: [
          {
            importPath: '/data/user1/',
            isValid: false,
            message: 'Lacking read permission for folder',
          },
        ],
      });
    });

    it('should detect when import path is not absolute', async () => {
      const cwd = process.cwd();

      await expect(sut.validate('library-id', { importPaths: ['relative/path'] })).resolves.toEqual({
        importPaths: [
          {
            importPath: 'relative/path',
            isValid: false,
            message: `Import path must be absolute, try ${cwd}/relative/path`,
          },
        ],
      });
    });

    it('should detect when import path is in immich media folder', async () => {
      storageMock.stat.mockResolvedValue({ isDirectory: () => true } as Stats);
      const cwd = process.cwd();

      const validImport = `${cwd}/${libraryStub.hasImmichPaths.importPaths[1]}`;
      storageMock.checkFileExists.mockImplementation((importPath) => Promise.resolve(importPath === validImport));

      const pathStubs = libraryStub.hasImmichPaths.importPaths;
      const importPaths = [pathStubs[0], validImport, pathStubs[2]];

      await expect(sut.validate('library-id', { importPaths })).resolves.toEqual({
        importPaths: [
          {
            importPath: libraryStub.hasImmichPaths.importPaths[0],
            isValid: false,
            message: 'Cannot use media upload folder for external libraries',
          },
          {
            importPath: validImport,
            isValid: true,
          },
          {
            importPath: libraryStub.hasImmichPaths.importPaths[2],
            isValid: false,
            message: 'Cannot use media upload folder for external libraries',
          },
        ],
      });
    });
  });
});
