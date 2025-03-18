import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/album.entity.dart';
import 'package:immich_mobile/entities/asset.entity.dart';
import 'package:immich_mobile/interfaces/timeline.interface.dart';
import 'package:immich_mobile/providers/app_settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart';
import 'package:immich_mobile/repositories/timeline.repository.dart';
import 'package:immich_mobile/services/app_settings.service.dart';
import 'package:immich_mobile/widgets/asset_grid/asset_grid_data_structure.dart';

final timelineServiceProvider = Provider<TimelineService>((ref) {
  return TimelineService(
    ref.watch(timelineRepositoryProvider),
    ref.watch(appSettingsServiceProvider),
    ref.watch(userServiceProvider),
  );
});

class TimelineService {
  final ITimelineRepository _timelineRepository;
  final AppSettingsService _appSettingsService;
  final UserService _userService;

  const TimelineService(
    this._timelineRepository,
    this._appSettingsService,
    this._userService,
  );

  Future<List<int>> getTimelineUserIds() async {
    final me = _userService.getMyUser();
    return _timelineRepository.getTimelineUserIds(me.id);
  }

  Stream<List<int>> watchTimelineUserIds() async* {
    final me = _userService.getMyUser();
    yield* _timelineRepository.watchTimelineUsers(me.id);
  }

  Stream<RenderList> watchHomeTimeline(int userId) {
    return _timelineRepository.watchHomeTimeline(userId, _getGroupByOption());
  }

  Stream<RenderList> watchMultiUsersTimeline(List<int> userIds) {
    return _timelineRepository.watchMultiUsersTimeline(
      userIds,
      _getGroupByOption(),
    );
  }

  Stream<RenderList> watchArchiveTimeline() async* {
    final user = _userService.getMyUser();

    yield* _timelineRepository.watchArchiveTimeline(user.id);
  }

  Stream<RenderList> watchFavoriteTimeline() async* {
    final user = _userService.getMyUser();

    yield* _timelineRepository.watchFavoriteTimeline(user.id);
  }

  Stream<RenderList> watchAlbumTimeline(Album album) async* {
    yield* _timelineRepository.watchAlbumTimeline(
      album,
      _getGroupByOption(),
    );
  }

  Stream<RenderList> watchTrashTimeline() async* {
    final user = _userService.getMyUser();

    yield* _timelineRepository.watchTrashTimeline(user.id);
  }

  Stream<RenderList> watchAllVideosTimeline() {
    return _timelineRepository.watchAllVideosTimeline();
  }

  Future<RenderList> getTimelineFromAssets(
    List<Asset> assets,
    GroupAssetsBy? groupBy,
  ) {
    GroupAssetsBy groupOption = GroupAssetsBy.none;
    if (groupBy != null) {
      groupOption = groupBy;
    } else {
      groupOption = _getGroupByOption();
    }

    return _timelineRepository.getTimelineFromAssets(
      assets,
      groupOption,
    );
  }

  Stream<RenderList> watchAssetSelectionTimeline() async* {
    final user = _userService.getMyUser();

    yield* _timelineRepository.watchAssetSelectionTimeline(user.id);
  }

  GroupAssetsBy _getGroupByOption() {
    return GroupAssetsBy
        .values[_appSettingsService.getSetting(AppSettingsEnum.groupAssetsBy)];
  }
}
