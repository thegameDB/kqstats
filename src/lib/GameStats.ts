import * as uuid from 'uuid/v4';
import { KQStream, Character, PlayerKill } from './KQStream';

type StatisticType = 'kills' | 'queen_kills' | 'other_kills' | 'deaths';

interface Enum {
    [key: number]: string;
}

export interface GameStatsType {
    // Should be [character in Character], but there's a regression in TypeScript:
    // https://github.com/Microsoft/TypeScript/issues/13042
    [character: number]: {
        [statisticType in StatisticType]: number
    };
}

export interface GameStatsFilter {
    // Should be [character in Character], but there's a regression in TypeScript:
    // https://github.com/Microsoft/TypeScript/issues/13042
    [character: number]: StatisticType[];
}

export interface KQStat {
    character: Character;
    statistic: StatisticType;
    value: number;
}

export type GameStatsCallback<T> = (data: T) => any;

interface GameStatsCallbackDictionary<T> {
    [id: string]: GameStatsCallback<T>;
}

export class GameStats {
    private stream: KQStream;
    private gameStats: GameStatsType;
    private onChange: GameStatsCallbackDictionary<KQStat>;

    /**
     * Complete list of valid statistic types.
     */
    static get statisticTypes(): StatisticType[] {
        return [
            'kills',
            'queen_kills',
            'other_kills',
            'deaths'
        ];
    }
    /**
     * Default game statistics. This is what the
     * statistics of a game are when it begins.
     */
    static get defaultGameStats(): GameStatsType {
        const defaultGameStats: GameStatsType = {};
        const characterValues = GameStats.getEnumNumbers(Character);
        for (let character of characterValues) {
            defaultGameStats[character] = {} as any;
            for (let statistic of GameStats.statisticTypes) {
                defaultGameStats[character][statistic] = 0;
            }
        }
        return defaultGameStats;
    }
    static get defaultChangeFilter(): GameStatsFilter {
        const defaultChangeFilter: GameStatsFilter = {};
        const characterValues = GameStats.getEnumNumbers(Character);
        for (let character of characterValues) {
            defaultChangeFilter[character] = GameStats.statisticTypes;
        }
        return defaultChangeFilter;
    }
    /**
     * Get all the number values of an enum.
     * 
     * This function is only relevant if your
     * enum uses number values, as opposed to
     * other value types (e.g. strings).
     * 
     * @param e The enum whose number values to get
     */
    static getEnumNumbers(e: Enum): number[] {
        const values: number[] = [];
        for (let key of Object.keys(e)) {
            const n = Number(key);
            if (!isNaN(n)) {
                values.push(n);
            }
        }
        return values;
    }

    constructor(stream: KQStream) {
        this.stream = stream;
        this.onChange = {};
    }

    on(eventType: 'change', callback: GameStatsCallback<KQStat>): string;
    on(eventType: string, callback: GameStatsCallback<any>): string {
        let id = uuid();
        switch (eventType) {
        case 'change':
            while (this.onChange[id] !== undefined) {
                id = uuid();
            }
            this.onChange[id] = callback;
            break;
        default:
            throw new Error(`${eventType} is not a supported event type`);
        }
        return id;
    }

    off(eventType: 'change', id?: string): boolean;
    off(eventType: string, id?: string): boolean {
        let removed = false;
        if (id !== undefined) {
            switch (eventType) {
            case 'change':
                if (this.onChange[id] !== undefined) {
                    delete this.onChange[id];
                    removed = true;
                }
                break;
            default:
                throw new Error(`${eventType} is not a supported event type`);   
            }
        } else {
            let keys: string[] = [];
            switch (eventType) {
            case 'change':
                keys = Object.keys(this.onChange);
                removed = keys.length > 0;
                this.onChange = {};
                break;
            default:
                throw new Error(`${eventType} is not a supported event type`);
            }
        }
        return removed;
    }

    start() {
        this.resetStats();
        this.stream.on('playernames', () => {
            this.resetStats();
        });
        this.stream.on('playerKill', (kill: PlayerKill) => {
            this.processKill(kill);
        });
    }

    /**
     * Triggers a change event on the specified statistics.
     * If no filter is specified, a change event is triggered
     * for all statistics.
     * 
     * @param eventType The 'change' event
     * @param filter The statistics to filter
     */
    trigger(eventType: 'change', filter?: GameStatsFilter) {
        const ids = Object.keys(this.onChange);
        if (ids.length > 0) {
            if (filter === undefined) {
                filter = GameStats.defaultChangeFilter;
            }
            for (let character of Object.keys(filter)) {
                const characterNumber = Number(character);
                if (!isNaN(characterNumber)) {
                    for (let statistic of filter[character]) {
                        for (let id of ids) {
                            this.onChange[id]({
                                character: characterNumber,
                                statistic: statistic,
                                value: this.gameStats[characterNumber][statistic]
                            });
                        }
                    }
                }
            }
        }
    }

    private resetStats() {
        this.gameStats = GameStats.defaultGameStats;
        this.trigger('change');
    }

    private processKill(kill: PlayerKill) {
        this.gameStats[kill.by].kills++;

        // Track queen kills vs other kils
        if (kill.killed === 1 || kill.killed === 2) {
            this.gameStats[kill.by].queen_kills++;
        } else {
            this.gameStats[kill.by].other_kills++;
        }

        this.gameStats[kill.killed].deaths++;
        this.trigger('change', {
            [kill.by]: ['kills', 'queen_kills', 'other_kills'],
            [kill.killed]: ['deaths']
        });
    }
}
