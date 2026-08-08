import { describe, expect, it } from 'bun:test';
import { collectRegisteredCommandPayloads } from './commandRegistrySync';

type ApiCall = { builtData: unknown; registerOptions: unknown };

function fakeCommand(apiCalls: ApiCall[] | unknown) {
  return { applicationCommandRegistry: { apiCalls } };
}

describe('collectRegisteredCommandPayloads', () => {
  it('routes guild-scoped entries into the guild bucket, not global', () => {
    const cmd = fakeCommand([
      { builtData: { name: 'ping' }, registerOptions: { guildIds: ['G1'] } },
    ]);

    const collected = collectRegisteredCommandPayloads([cmd]);

    expect(collected.global).toHaveLength(0);
    expect(collected.byGuild.get('G1')?.map((x) => x.data.name)).toEqual(['ping']);
    expect(collected.byGuild.get('G1')?.[0]?.piece).toBe(cmd);
  });

  it('routes entries without guildIds (absent or empty) into global', () => {
    const collected = collectRegisteredCommandPayloads([
      fakeCommand([{ builtData: { name: 'a' }, registerOptions: {} }]),
      fakeCommand([{ builtData: { name: 'b' }, registerOptions: { guildIds: [] } }]),
    ]);

    expect(collected.global.map((x) => x.data.name).sort()).toEqual(['a', 'b']);
    expect(collected.byGuild.size).toBe(0);
  });

  it('fans a multi-guild entry out to every listed guild', () => {
    const collected = collectRegisteredCommandPayloads([
      fakeCommand([{ builtData: { name: 'multi' }, registerOptions: { guildIds: ['G1', 'G2'] } }]),
    ]);

    expect(collected.byGuild.get('G1')?.map((x) => x.data.name)).toEqual(['multi']);
    expect(collected.byGuild.get('G2')?.map((x) => x.data.name)).toEqual(['multi']);
  });

  it('contributes nothing for a command with empty apiCalls (the Explain case)', () => {
    const collected = collectRegisteredCommandPayloads([fakeCommand([])]);

    expect(collected.global).toHaveLength(0);
    expect(collected.byGuild.size).toBe(0);
  });

  it('skips pieces without a registry entirely', () => {
    const collected = collectRegisteredCommandPayloads([{} as object]);

    expect(collected.global).toHaveLength(0);
  });

  it('dedupes duplicate (name, type) pairs within a bucket, last wins', () => {
    const collected = collectRegisteredCommandPayloads([
      fakeCommand([
        { builtData: { name: 'dup', description: 'first' }, registerOptions: {} },
        { builtData: { name: 'dup', description: 'second' }, registerOptions: {} },
        // Different type → distinct entry, kept alongside.
        { builtData: { name: 'dup', type: 3 }, registerOptions: {} },
      ]),
    ]);

    expect(collected.global).toHaveLength(2);
    const chatInput = collected.global.find((x) => x.data.type === undefined);
    expect(chatInput?.data.description).toBe('second');
  });

  it('throws the descriptive shape error when apiCalls is not an array', () => {
    expect(() => collectRegisteredCommandPayloads([fakeCommand({ not: 'an array' })])).toThrow(
      /apiCalls shape changed/,
    );
  });

  it('throws the descriptive shape error when builtData.name is missing', () => {
    expect(() =>
      collectRegisteredCommandPayloads([
        fakeCommand([{ builtData: { description: 'nameless' }, registerOptions: {} }]),
      ]),
    ).toThrow(/apiCalls shape changed/);
  });
});
