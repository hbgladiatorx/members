import { useCallback } from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { ChannelRow } from '../../components/ChannelRow';
import { Empty, ErrorText, Loading } from '../../components/ui';
import { useSocketEvent } from '../../lib/socket';
import { colors, font, space } from '../../lib/theme';
import type { Channel } from '../../lib/types';
import { useFetch } from '../../lib/useFetch';

export default function ChatsScreen() {
  const { data, error, refreshing, reload, refetch } = useFetch<{ channels: Channel[] }>('/channels');
  const onLive = useCallback(() => refetch(), [refetch]);
  useSocketEvent('message:new', onLive);
  useSocketEvent('channel:added', onLive);

  return (
    <FlatList
      data={data?.channels ?? []}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ paddingVertical: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.primary} />}
      ListEmptyComponent={
        !data ? (
          error ? <ErrorText>{error}</ErrorText> : <Loading />
        ) : (
          <Empty icon="chatbubbles-outline" title="No chats yet" body="Class group chats appear here when you join a class. Start a direct message from a class's member list." />
        )
      }
      renderItem={({ item }) => <ChannelRow channel={item} />}
    />
  );
}

