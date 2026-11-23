/** Shows a "you've been invited" prompt whenever a meeting invite arrives over the socket. */
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';

import { useSocket } from '../realtime/SocketContext';

export function MeetingInviteListener() {
  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return;
    const onInvited = (d: { meeting_id: string; title: string; host: string }) => {
      Alert.alert('Meeting invitation', `${d.host} invited you to "${d.title}".`, [
        { text: 'Later', style: 'cancel' },
        { text: 'Join', onPress: () => router.push({ pathname: '/meeting/[id]', params: { id: d.meeting_id } }) },
      ]);
    };
    socket.on('meeting:invited', onInvited);
    return () => {
      socket.off('meeting:invited', onInvited);
    };
  }, [socket]);
  return null;
}
