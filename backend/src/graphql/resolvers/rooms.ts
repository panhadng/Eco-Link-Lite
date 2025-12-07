/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { withFilter } from 'graphql-subscriptions'
import { neo4jgraphql } from 'neo4j-graphql-js'

import { ROOM_COUNT_UPDATED } from '@constants/subscriptions'

import Resolver from './helpers/Resolver'

export const getUnreadRoomsCount = async (userId, session) => {
  return session.readTransaction(async (transaction) => {
    const unreadRoomsCypher = `
      MATCH (user:User { id: $userId })-[:CHATS_IN]->(room:Room)<-[:INSIDE]-(message:Message)<-[:CREATED]-(sender:User)
      WHERE NOT sender.id = $userId AND NOT message.seen
      AND NOT (user)-[:BLOCKED]->(sender)
      AND NOT (user)-[:MUTED]->(sender)
      RETURN toString(COUNT(DISTINCT room)) AS count
    `
    const unreadRoomsTxResponse = await transaction.run(unreadRoomsCypher, { userId })
    return unreadRoomsTxResponse.records.map((record) => record.get('count'))[0]
  })
}

export default {
  Subscription: {
    roomCountUpdated: {
      subscribe: withFilter(
        (_, __, context) => context.pubsub.asyncIterator(ROOM_COUNT_UPDATED),
        (payload, variables, context) => {
          return payload.userId === context.user?.id
        },
      ),
    },
  },
  Query: {
    Room: async (object, params, context, resolveInfo) => {
      if (!params.filter) params.filter = {}
      params.filter.users_some = {
        id: context.user.id,
      }
      return neo4jgraphql(object, params, context, resolveInfo)
    },
    UnreadRooms: async (_object, _params, context, _resolveInfo) => {
      const {
        user: { id: currentUserId },
      } = context
      const session = context.driver.session()
      try {
        const count = await getUnreadRoomsCount(currentUserId, session)
        return count
      } finally {
        session.close()
      }
    },
  },
  Mutation: {
    CreateRoom: async (_parent, params, context, _resolveInfo) => {
      const { userId, userIds, groupName } = params
      const {
        user: { id: currentUserId },
      } = context

      // Determine which users to add to the room
      let targetUserIds: string[] = []
      if (userIds && userIds.length > 0) {
        // Group chat: use userIds array
        targetUserIds = userIds.filter((id) => id !== currentUserId)
        if (targetUserIds.length === 0) {
          throw new Error('Cannot create a group with only yourself')
        }
      } else if (userId) {
        // 1:1 chat: use single userId
        if (userId === currentUserId) {
          throw new Error('Cannot create a room with self')
        }
        targetUserIds = [userId]
      } else {
        throw new Error('Either userId or userIds must be provided')
      }

      const isGroup = targetUserIds.length > 1 || groupName

      const session = context.driver.session()
      const writeTxResultPromise = session.writeTransaction(async (transaction) => {
        let createRoomCypher: string

        if (isGroup) {
          // Group chat: always create a new room
          createRoomCypher = `
            MATCH (currentUser:User { id: $currentUserId })
            CREATE (room:Room {
              createdAt: toString(datetime()),
              id: apoc.create.uuid(),
              ${groupName ? 'groupName: $groupName,' : ''}
              isGroup: true,
              updatedAt: toString(datetime())
            })
            CREATE (currentUser)-[:CHATS_IN]->(room)
            WITH room, currentUser
            UNWIND $targetUserIds AS targetUserId
            MATCH (targetUser:User { id: targetUserId })
            WHERE NOT (targetUser)-[:CHATS_IN]->(room)
            CREATE (targetUser)-[:CHATS_IN]->(room)
            WITH room, currentUser
            MATCH (room)<-[:CHATS_IN]-(user:User)
            WITH room, collect(DISTINCT properties(user)) as users, count(user) as userCount
            OPTIONAL MATCH (room)<-[:INSIDE]-(message:Message)<-[:CREATED]-(sender:User)
            WHERE NOT sender.id = $currentUserId AND NOT message.seen
            OPTIONAL MATCH (room)-[:GROUP_AVATAR]->(groupAvatarImg:Image)
            WITH room, users, userCount, message, groupAvatarImg,
                 CASE 
                   WHEN room.groupName IS NOT NULL AND room.groupName <> '' THEN room.groupName
                   ELSE 'Group Chat'
                 END AS computedRoomName,
                 groupAvatarImg.url as computedGroupAvatar
            RETURN room {
              .*,
              users: users,
              roomName: computedRoomName,
              groupName: room.groupName,
              groupAvatar: computedGroupAvatar,
              avatar: computedGroupAvatar,
              isGroup: true,
              unreadCount: toString(COUNT(DISTINCT message))
            }
          `
        } else {
          // 1:1 chat: use MERGE to find existing room or create new one
          const otherUserId = targetUserIds[0]
          createRoomCypher = `
            MATCH (currentUser:User { id: $currentUserId })
            MATCH (otherUser:User { id: $otherUserId })
            MERGE (currentUser)-[:CHATS_IN]->(room:Room)<-[:CHATS_IN]-(otherUser)
            ON CREATE SET
              room.createdAt = toString(datetime()),
              room.id = apoc.create.uuid(),
              room.updatedAt = toString(datetime())
            WITH room, currentUser, otherUser
            OPTIONAL MATCH (room)<-[:INSIDE]-(message:Message)<-[:CREATED]-(sender:User)
            WHERE NOT sender.id = $currentUserId AND NOT message.seen
            WITH room, currentUser, otherUser, message,
            otherUser.name AS roomName
            RETURN room {
              .*,
              users: [properties(currentUser), properties(otherUser)],
              roomName: roomName,
              unreadCount: toString(COUNT(DISTINCT message))
            }
          `
        }

        const createRoomTxResponse = await transaction.run(createRoomCypher, {
          currentUserId,
          targetUserIds: isGroup ? targetUserIds : undefined,
          otherUserId: isGroup ? undefined : targetUserIds[0],
          groupName: groupName || null,
        })
        const [roomData] = await createRoomTxResponse.records.map((record) => record.get('room'))
        return roomData
      })
      try {
        const roomData = await writeTxResultPromise
        if (!roomData || !roomData.id) {
          throw new Error('Failed to create room')
        }
        
        // All fields are already computed in the Cypher query above
        // Just ensure roomId is set
        if (roomData) {
          roomData.roomId = roomData.id
        }
        return roomData
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
    AddUsersToRoom: async (_parent, params, context, _resolveInfo) => {
      const { roomId, userIds } = params
      const {
        user: { id: currentUserId },
      } = context

      const session = context.driver.session()
      const writeTxResultPromise = session.writeTransaction(async (transaction) => {
        // Verify current user is in the room
        const verifyCypher = `
          MATCH (currentUser:User { id: $currentUserId })-[:CHATS_IN]->(room:Room { id: $roomId })
          RETURN room
        `
        const verifyResponse = await transaction.run(verifyCypher, {
          currentUserId,
          roomId,
        })
        if (verifyResponse.records.length === 0) {
          throw new Error('You are not a member of this room')
        }

        // Collect user IDs that will be added
        const usersToAdd = userIds.filter((id) => id !== currentUserId)
        
        // Add users to room and collect added user IDs
        const addUsersCypher = `
          MATCH (room:Room { id: $roomId })
          UNWIND $userIds AS userId
          MATCH (user:User { id: userId })
          WHERE NOT (user)-[:CHATS_IN]->(room)
            AND NOT user.id = $currentUserId
          WITH room, user, userId
          CREATE (user)-[:CHATS_IN]->(room)
          WITH room, collect(DISTINCT userId) as addedUserIds
          SET room.updatedAt = toString(datetime())
          WITH room, addedUserIds
          MATCH (room)<-[:CHATS_IN]-(user:User)
          RETURN room {
            .*,
            users: collect(DISTINCT properties(user))
          }, addedUserIds
        `
        const addUsersTxResponse = await transaction.run(addUsersCypher, {
          roomId,
          userIds: usersToAdd,
          currentUserId,
        })
        const [result] = await addUsersTxResponse.records.map((record) => ({
          room: record.get('room'),
          addedUserIds: record.get('addedUserIds') || [],
        }))
        return result
      })
      try {
        const result = await writeTxResultPromise
        const room = result?.room
        const addedUserIds = result?.addedUserIds || []
        
        // Notify added users that they've been added to a room
        if (addedUserIds.length > 0) {
          for (const userId of addedUserIds) {
            const userSession = context.driver.session()
            try {
              const roomCountUpdated = await getUnreadRoomsCount(userId, userSession)
              void context.pubsub.publish(ROOM_COUNT_UPDATED, {
                roomCountUpdated,
                userId,
              })
            } finally {
              userSession.close()
            }
          }
        }
        
        if (room) {
          room.roomId = room.id
        }
        return room
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
    RemoveUserFromRoom: async (_parent, params, context, _resolveInfo) => {
      const { roomId, userId } = params
      const {
        user: { id: currentUserId },
      } = context

      const session = context.driver.session()
      const writeTxResultPromise = session.writeTransaction(async (transaction) => {
        // Verify current user is in the room
        const verifyCypher = `
          MATCH (currentUser:User { id: $currentUserId })-[:CHATS_IN]->(room:Room { id: $roomId })
          RETURN room
        `
        const verifyResponse = await transaction.run(verifyCypher, {
          currentUserId,
          roomId,
        })
        if (verifyResponse.records.length === 0) {
          throw new Error('You are not a member of this room')
        }

        // Check if user to remove is in the room
        const checkUserCypher = `
          MATCH (room:Room { id: $roomId })<-[:CHATS_IN]-(user:User { id: $userId })
          RETURN count(user) as userCount
        `
        const checkResponse = await transaction.run(checkUserCypher, {
          roomId,
          userId,
        })
        const userCount = checkResponse.records[0]?.get('userCount') || 0
        if (userCount === 0) {
          throw new Error('User is not a member of this room')
        }

        // Get remaining user count
        const countCypher = `
          MATCH (room:Room { id: $roomId })<-[:CHATS_IN]-(user:User)
          RETURN count(user) as totalCount
        `
        const countResponse = await transaction.run(countCypher, { roomId })
        const totalCount = countResponse.records[0]?.get('totalCount') || 0

        if (totalCount <= 2) {
          throw new Error('Cannot remove user from a 1:1 chat. Use LeaveRoom instead.')
        }

        // Remove user from room
        const removeUserCypher = `
          MATCH (room:Room { id: $roomId })<-[r:CHATS_IN]-(user:User { id: $userId })
          DELETE r
          WITH room
          SET room.updatedAt = toString(datetime())
          MATCH (room)<-[:CHATS_IN]-(user:User)
          RETURN room {
            .*,
            users: collect(DISTINCT properties(user))
          }
        `
        const removeUserTxResponse = await transaction.run(removeUserCypher, {
          roomId,
          userId,
        })
        const [room] = await removeUserTxResponse.records.map((record) => record.get('room'))
        return room
      })
      try {
        const room = await writeTxResultPromise
        if (room) {
          room.roomId = room.id
        }
        return room
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
    UpdateRoomName: async (_parent, params, context, _resolveInfo) => {
      const { roomId, groupName } = params
      const {
        user: { id: currentUserId },
      } = context

      const session = context.driver.session()
      const writeTxResultPromise = session.writeTransaction(async (transaction) => {
        // Verify current user is in the room
        const verifyCypher = `
          MATCH (currentUser:User { id: $currentUserId })-[:CHATS_IN]->(room:Room { id: $roomId })
          RETURN room
        `
        const verifyResponse = await transaction.run(verifyCypher, {
          currentUserId,
          roomId,
        })
        if (verifyResponse.records.length === 0) {
          throw new Error('You are not a member of this room')
        }

        // Update room name
        const updateNameCypher = `
          MATCH (room:Room { id: $roomId })
          SET room.groupName = $groupName,
              room.updatedAt = toString(datetime()),
              room.isGroup = true
          MATCH (room)<-[:CHATS_IN]-(user:User)
          RETURN room {
            .*,
            users: collect(DISTINCT properties(user))
          }
        `
        const updateNameTxResponse = await transaction.run(updateNameCypher, {
          roomId,
          groupName,
        })
        const [room] = await updateNameTxResponse.records.map((record) => record.get('room'))
        return room
      })
      try {
        const room = await writeTxResultPromise
        if (room) {
          room.roomId = room.id
        }
        return room
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
    LeaveRoom: async (_parent, params, context, _resolveInfo) => {
      const { roomId } = params
      const {
        user: { id: currentUserId },
      } = context

      const session = context.driver.session()
      const writeTxResultPromise = session.writeTransaction(async (transaction) => {
        // Check if user is in the room
        const checkCypher = `
          MATCH (room:Room { id: $roomId })<-[r:CHATS_IN]-(user:User { id: $currentUserId })
          MATCH (room)<-[:CHATS_IN]-(allUsers:User)
          WITH room, r, count(allUsers) as userCount
          RETURN r, userCount
        `
        const checkResponse = await transaction.run(checkCypher, {
          roomId,
          currentUserId,
        })
        if (checkResponse.records.length === 0) {
          throw new Error('You are not a member of this room')
        }

        const userCount = checkResponse.records[0]?.get('userCount') || 0

        // Remove user from room
        const leaveCypher = `
          MATCH (room:Room { id: $roomId })<-[r:CHATS_IN]-(user:User { id: $currentUserId })
          DELETE r
          SET room.updatedAt = toString(datetime())
          RETURN true as success
        `
        await transaction.run(leaveCypher, {
          roomId,
          currentUserId,
        })

        return true
      })
      try {
        await writeTxResultPromise
        return true
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
    DeleteRoom: async (_parent, params, context, _resolveInfo) => {
      const { roomId } = params
      const {
        user: { id: currentUserId },
      } = context

      const session = context.driver.session()
      const writeTxResultPromise = session.writeTransaction(async (transaction) => {
        // Verify user is in the room and it's a group chat
        const checkRoomCypher = `
          MATCH (currentUser:User { id: $currentUserId })-[:CHATS_IN]->(room:Room { id: $roomId })
          MATCH (room)<-[:CHATS_IN]-(user:User)
          WITH room, count(user) as userCount
          RETURN room, userCount
        `
        const checkResponse = await transaction.run(checkRoomCypher, {
          roomId,
          currentUserId,
        })
        
        if (checkResponse.records.length === 0) {
          throw new Error('You are not a member of this room or room does not exist')
        }

        const userCount = checkResponse.records[0]?.get('userCount') || 0
        
        // Only allow deletion of group chats (2+ users), not 1:1 chats
        if (userCount <= 2) {
          throw new Error('Cannot delete a 1:1 chat. Use LeaveRoom instead.')
        }

        // Delete all messages in the room
        const deleteMessagesCypher = `
          MATCH (room:Room { id: $roomId })<-[:INSIDE]-(message:Message)
          DETACH DELETE message
        `
        await transaction.run(deleteMessagesCypher, { roomId })

        // Delete all relationships and the room
        const deleteRoomCypher = `
          MATCH (room:Room { id: $roomId })
          OPTIONAL MATCH (room)<-[r:CHATS_IN]-()
          OPTIONAL MATCH (room)-[r2:GROUP_AVATAR]->()
          DETACH DELETE room, r, r2
          RETURN true as deleted
        `
        await transaction.run(deleteRoomCypher, { roomId })

        return true
      })
      try {
        await writeTxResultPromise
        return true
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
  },
  Room: {
    ...Resolver('Room', {
      undefinedToNull: ['lastMessageAt'],
      hasMany: {
        users: '<-[:CHATS_IN]-(related:User)',
      },
    }),
  },
}
