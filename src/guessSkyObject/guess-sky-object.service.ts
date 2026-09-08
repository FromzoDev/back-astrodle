import { Injectable, BadRequestException } from '@nestjs/common';
import {
  PlayableGame,
  SelectedContent,
  GuessResult,
} from '../game/interfaces/playable-game.interface';
import { GameSession } from '../game/gameSession/game-session.entity';
import { GameMode } from '../common/enum/game-mode.enum';
import { GameStatus } from '../common/enum/game-status.enum';
import { SpaceSkyObjectRepository } from '../spaceSkyObject/space-sky-object.repository';
import { GuessSkyObjectGameRepository } from './guess-sky-object-game.repository';
import { GuessSkyObjectStatsRepository } from './guess-sky-object-stats.repository';
import { GuessSkyObjectSessionData } from './guess-sky-object-session-data.interface';
import { HINT_POOL } from './hint-pool';
import { pickRandomUnused, pickRandomHint } from './guess-sky-object.utils';
import { normalizeText } from '../common/utils/normalize-text';
import { GameType } from '../common/enum/game-type.enum';
import { GameStatsRepository } from '../game/gameStats/game-stats.repository';

@Injectable()
export class GuessSkyObjectService implements PlayableGame {
  constructor(
    private readonly spaceSkyObjectRepository: SpaceSkyObjectRepository,
    private readonly guessSkyObjectGameRepository: GuessSkyObjectGameRepository,
    private readonly guessSkyObjectStatsRepository: GuessSkyObjectStatsRepository,
    private readonly gameStatsRepository: GameStatsRepository,
  ) {}

  async selectContent(mode: GameMode): Promise<SelectedContent> {
    const game =
      mode === GameMode.Daily
        ? await this.guessSkyObjectGameRepository.findTodaysGame()
        : await this.guessSkyObjectGameRepository.findRandomEnabled();

    if (!game) {
      throw new BadRequestException('Aucun objet disponible pour ce mode');
    }

    const initialGameData: GuessSkyObjectSessionData = {
      attemptsUsed: 0,
      maxAttempts: 10,
      nameLength: game.spaceSkyObject.name.length,
      revealedTileIndexes: [],
      revealedLetterIndexes: [],
      revealedHintKeys: [],
    };

    return {
      contentId: game.spaceSkyObject.id,
      initialGameData,
    };
  }

  async processAction( session: GameSession, action: unknown,): Promise<GuessResult> {
    const { guess } = action as { guess: string };
    const data = session.gameData as GuessSkyObjectSessionData;

    const spaceSkyObject = await this.spaceSkyObjectRepository.findOneById(
      session.contentId,
    );
    if (!spaceSkyObject) {
      throw new BadRequestException('Objet introuvable');
    }

    const isCorrect = normalizeText(guess) === normalizeText(spaceSkyObject.name);

    if (isCorrect) {
      return { status: GameStatus.Won, gameData: data };
    }

    const attemptsUsed = data.attemptsUsed + 1;

    if (attemptsUsed >= data.maxAttempts) {
      return {
        status: GameStatus.Lost,
        gameData: { ...data, attemptsUsed },
      };
    }

    const newTile = pickRandomUnused([0, 1, 2, 3, 4, 5, 6, 7, 8],data.revealedTileIndexes, );
    const namePositions = Array.from({ length: data.nameLength }, (_, i) => i);
    const newLetter = pickRandomUnused( namePositions, data.revealedLetterIndexes, );
    const newHint = pickRandomHint(data.revealedHintKeys);

    const updatedData: GuessSkyObjectSessionData = {
      ...data,
      attemptsUsed,
      revealedTileIndexes:
        newTile !== null
          ? [...data.revealedTileIndexes, newTile]
          : data.revealedTileIndexes,
      revealedLetterIndexes:
        newLetter !== null
          ? [...data.revealedLetterIndexes, newLetter]
          : data.revealedLetterIndexes,
      revealedHintKeys: newHint
        ? [...data.revealedHintKeys, newHint.key]
        : data.revealedHintKeys,
    };

    return { status: GameStatus.InProgress, gameData: updatedData };
  }

  async onGameFinished(
    session: GameSession,
    status: GameStatus,
  ): Promise<void> {
    const data = session.gameData as GuessSkyObjectSessionData;
    const won = status === GameStatus.Won;

    const game = await this.guessSkyObjectGameRepository.findBySpaceSkyObjectId(
      session.contentId,
    );
    await this.guessSkyObjectGameRepository.incrementStats(
      game.id,
      data.attemptsUsed,
      won,
    );

    await this.guessSkyObjectStatsRepository.incrementOnFinish(
      session.mode,
      data.attemptsUsed,
      won,
    );
  }

  async buildClientView(session: GameSession): Promise<Record<string, any>> {
    const data = session.gameData as GuessSkyObjectSessionData;
    const isFinished = session.status !== GameStatus.InProgress;

    const spaceSkyObject = await this.spaceSkyObjectRepository.findOneById(
      session.contentId,
    );

    const partialName = isFinished
      ? spaceSkyObject.name
      : spaceSkyObject.name
          .split('')
          .map((char, i) =>
            data.revealedLetterIndexes.includes(i) || char === ' ' ? char : '_',
          )
          .join('');

    const hintKeys = isFinished
      ? HINT_POOL.map((h) => h.key)
      : data.revealedHintKeys;
    const revealedHints = hintKeys.map((key) => {
      const hint = HINT_POOL.find((h) => h.key === key);
      return { key, value: hint.resolve(spaceSkyObject) };
    });

    return {
      status: session.status,
      attemptsUsed: data.attemptsUsed,
      maxAttempts: data.maxAttempts,
      revealedTiles: data.revealedTileIndexes,
      partialName,
      revealedHints,
      ...(isFinished && {
        fullName: spaceSkyObject.name,
        objectImage: spaceSkyObject.objectImage,
      }),
    };
  }

  async getGlobalStats(mode: GameMode) {
    const universal = await this.gameStatsRepository.findByGameTypeAndMode(
      GameType.GuessSkyObject,
      mode,
    );
    const specific = await this.guessSkyObjectStatsRepository.findByMode(mode);

    return {
      totalPlayed: universal?.totalPlayed ?? 0,
      totalWon: universal?.totalWon ?? 0,
      totalLost: universal?.totalLost ?? 0,
      winRate: universal?.winRate ?? 0,
      avgAttemptsUsed: specific?.avgAttemptsUsed ?? 0,
      winCountByAttemptNumber: specific?.winCountByAttemptNumber ?? {},
    };
  }
}
