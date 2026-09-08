import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { GameSessionRepository } from './gameSession/game-session.repository';
import { GameStatsRepository } from './gameStats/game-stats.repository';
import { GameConfigRepository } from './gameConfig/game-config.repository';
import {
  PlayableGame,
  GuessResult,
} from './interfaces/playable-game.interface';
import { GameType } from '../common/enum/game-type.enum';
import { GameMode } from '../common/enum/game-mode.enum';
import { GameStatus } from '../common/enum/game-status.enum';
import { GameSession } from './gameSession/game-session.entity';
import { ErrorMessage } from '../common/enum/error.enum';

@Injectable()
export class GameService {
  constructor(
    private readonly gameSessionRepository: GameSessionRepository,
    private readonly gameStatsRepository: GameStatsRepository,
    private readonly gameConfigRepository: GameConfigRepository,
  ) {}

  async getAvailableGames(mode: GameMode): Promise<GameType[]> {
    const configs = await this.gameConfigRepository.findEnabledByMode(mode);
    return configs.map((c) => c.gameType);
  }

  async isGameAvailableInMode(
    gameType: GameType,
    mode: GameMode,
  ): Promise<boolean> {
    const config = await this.gameConfigRepository.findOneByGameTypeAndMode(
      gameType,
      mode,
    );
    return config?.isEnabled ?? false;
  }

  async play( gameType: GameType, mode: GameMode, gameLogic: PlayableGame, ): Promise<GameSession> {
    const isEnabled = await this.isGameAvailableInMode(gameType, mode);
    if (!isEnabled) {
      throw new ForbiddenException(ErrorMessage.GAME_NOT_AVAILABLE);
    }

    const { contentId, initialGameData } = await gameLogic.selectContent(mode);

    return this.gameSessionRepository.create({
      gameType,
      contentId,
      mode,
      status: GameStatus.InProgress,
      gameData: initialGameData ?? {},
    });
  }

  async submitAction( sessionId: string, action: unknown, gameLogic: PlayableGame): Promise<GameSession> {
    const session = await this.gameSessionRepository.findOneById(sessionId);

    if (!session) {
      throw new NotFoundException(ErrorMessage.GAME_SESSION_NOT_FOUND);
    }

    if (session.status !== GameStatus.InProgress) {
      throw new BadRequestException(ErrorMessage.GAME_SESSION_ALREADY_FINISHED);
    }

    const result: GuessResult = await gameLogic.processAction(session, action);

    const updatedSession = await this.gameSessionRepository.update(sessionId, {
      gameData: result.gameData ?? session.gameData,
      status: result.status,
      ...(result.status !== GameStatus.InProgress && {
        finishedAt: new Date(),
      }),
    });

    if (result.status === GameStatus.Won || result.status === GameStatus.Lost) {
      await this.gameStatsRepository.incrementCounters(
        session.gameType,
        session.mode,
        result.status === GameStatus.Won,
      );

      await gameLogic.onGameFinished(updatedSession, result.status);
    }

    return updatedSession;
  }
}
