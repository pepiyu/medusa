import { EntityManager } from "typeorm"
import { MedusaError } from "medusa-core-utils"

import { PublishableApiKeyRepository } from "../repositories/publishable-api-key"
import { FindConfig, QuerySelector, Selector } from "../types/common"
import { PublishableApiKey } from "../models/publishable-api-key"
import { TransactionBaseService } from "../interfaces"
import EventBusService from "./event-bus"
import { buildQuery } from "../utils"

type InjectedDependencies = {
  manager: EntityManager

  eventBusService: EventBusService
  publishableApiKeyRepository: typeof PublishableApiKeyRepository
}

/**
 * A service for PublishableApiKey business logic.
 */
class PublishableApiKeyService extends TransactionBaseService {
  static Events = {
    CREATED: "publishable_api_key.created",
    REVOKED: "publishable_api_key.revoked",
  }

  protected manager_: EntityManager
  protected transactionManager_: EntityManager | undefined

  protected readonly eventBusService_: EventBusService
  protected readonly publishableApiKeyRepository_: typeof PublishableApiKeyRepository

  constructor({
    manager,
    eventBusService,
    publishableApiKeyRepository,
  }: InjectedDependencies) {
    super(arguments[0])

    this.manager_ = manager
    this.eventBusService_ = eventBusService
    this.publishableApiKeyRepository_ = publishableApiKeyRepository
  }

  /**
   * Create a PublishableApiKey record.
   *
   * @params context - key creation context object
   */
  async create(context: {
    loggedInUserId: string
  }): Promise<PublishableApiKey | never> {
    return await this.atomicPhase_(async (manager) => {
      const publishableApiKeyRepo = manager.getCustomRepository(
        this.publishableApiKeyRepository_
      )

      const publishableApiKey = publishableApiKeyRepo.create({
        created_by: context.loggedInUserId,
      })

      await this.eventBusService_
        .withTransaction(manager)
        .emit(PublishableApiKeyService.Events.CREATED, {
          id: publishableApiKey.id,
        })

      return await publishableApiKeyRepo.save(publishableApiKey)
    })
  }

  /**
   * Retrieves a PublishableApiKey by id
   *
   * @param publishableApiKeyId - id of the key
   * @param config - a find config object
   */
  async retrieve(
    publishableApiKeyId: string,
    config: FindConfig<PublishableApiKey> = {}
  ): Promise<PublishableApiKey | never> {
    return await this.retrieve_({ id: publishableApiKeyId }, config)
  }

  /**
   * Generic retrieve for selecting PublishableApiKEys by different attributes.
   *
   * @param selector - a PublishableApiKey selector object
   * @param config - a find config object
   */
  protected async retrieve_(
    selector: Selector<PublishableApiKey>,
    config: FindConfig<PublishableApiKey> = {}
  ): Promise<PublishableApiKey | never> {
    const repo = this.manager_.getCustomRepository(
      this.publishableApiKeyRepository_
    )

    const { relations, ...query } = buildQuery(selector, config)
    const publishableApiKey = await repo.findOneWithRelations(
      relations as (keyof PublishableApiKey)[],
      query
    )

    if (!publishableApiKey) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `PublishableApiKey was not found`
      )
    }

    return publishableApiKey
  }

  /**
   * Lists publishable API keys based on the provided parameters.
   *
   * @return an array containing publishable API keys and a total count of records that matches the query
   */
  async listAndCount(
    selector: QuerySelector<PublishableApiKey>,
    config: FindConfig<PublishableApiKey> = {
      skip: 0,
      take: 20,
    }
  ): Promise<[PublishableApiKey[], number]> {
    const manager = this.manager_
    const pubKeyRepo = manager.getCustomRepository(
      this.publishableApiKeyRepository_
    )

    const query = buildQuery(selector, config)

    return await pubKeyRepo.findAndCount(query)
  }

  /**
   * Revoke a PublishableApiKey
   *
   * @param publishableApiKeyId - id of the key
   * @param context - key revocation context object
   */
  async revoke(
    publishableApiKeyId: string,
    context: {
      loggedInUserId: string
    }
  ): Promise<void | never> {
    return await this.atomicPhase_(async (manager) => {
      const repo = manager.getCustomRepository(
        this.publishableApiKeyRepository_
      )

      const pubKey = await this.retrieve(publishableApiKeyId)

      if (pubKey.revoked_at) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `PublishableApiKey has already been revoked.`
        )
      }

      pubKey.revoked_at = new Date()
      pubKey.revoked_by = context.loggedInUserId

      await repo.save(pubKey)

      await this.eventBusService_
        .withTransaction(manager)
        .emit(PublishableApiKeyService.Events.REVOKED, {
          id: pubKey.id,
        })
    })
  }

  /**
   * Check whether the key is active (i.e. haven't been revoked or deleted yet)
   *
   * @param publishableApiKeyId - id of the key
   */
  async isValid(publishableApiKeyId: string): Promise<boolean> {
    const pubKey = await this.retrieve(publishableApiKeyId)
    return pubKey.revoked_by === null
  }
}

export default PublishableApiKeyService