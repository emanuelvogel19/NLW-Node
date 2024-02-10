import z from "zod"
import { randomUUID } from "crypto"
import { prisma } from "../../lib/prisma"
import { FastifyInstance } from "fastify"
import { redis } from "../../lib/redis"
import { voting } from "../../utils/voting-pub-sub"

export async function voteOnPoll(app: FastifyInstance){
    app.post('/polls/:pollId/votes', async (request, reply) => {
        const voteOnPollBody = z.object({
            pollOptionId: z.string().uuid()
        })

        const voteOnPollParams = z.object({
            pollId: z.string().uuid(),
        })

        const { pollId } = voteOnPollParams.parse(request.params)
        const { pollOptionId } = voteOnPollBody.parse(request.body)
    
        let {sessionId} = request.cookies

        if(sessionId){
            const userPreviousVOteOnPoll = await prisma.vote.findUnique({
                where: {
                    sessionId_pollId:{
                        sessionId,
                        pollId,
                    },
                }
            })

            if(userPreviousVOteOnPoll && userPreviousVOteOnPoll.pollOptionId != pollOptionId){
              //Apagar voto anterior e criar um novo
              await prisma.vote.delete({
                where:{
                    id: userPreviousVOteOnPoll.id,
                }
              })

            const votes = await redis.zincrby(pollId,-1,userPreviousVOteOnPoll.pollOptionId)

              voting.publish(pollId, {
                pollOptionId: userPreviousVOteOnPoll.pollOptionId,
                votes: Number(votes),
            })

            }else if(userPreviousVOteOnPoll){
                return reply.status(400).send({message: 'You already voted on this poll'})
            }
        }

        if(!sessionId){
            sessionId = randomUUID()
        
            reply.setCookie('sessionId', sessionId,{
                path: '/',
                maxAge: 60 * 60 * 24 * 30,
                signed: true,
                httpOnly: true,
            })
        }
        
        await prisma.vote.create({
            data:{
                sessionId,
                pollId,
                pollOptionId
            }
        })

        const votes = await redis.zincrby(pollId,1,pollOptionId)

        voting.publish(pollId, {
            pollOptionId,
            votes: Number(votes),
        })

        return reply.status(201).send()
    })
}