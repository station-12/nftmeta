import JsonRpc from 'node-jsonrpc-client';
import * as web3 from '@solana/web3.js';
import { Metadata, METADATA_SCHEMA } from './types.js';
import * as borsh from 'borsh';

const { PublicKey } = web3;

const rpcHost = process.env.RPC_HOST || process.env.REACT_APP_SOLANA_RPC_HOST || 'https://explorer-api.devnet.solana.com';
const client = new JsonRpc(rpcHost);

const pubKeyCache = {};
const addressCache = {};

function toPublicKey(key) {
    if (typeof key !== 'string') {
        return key;
    }

    let result = pubKeyCache[key];

    if ( result == null ) {
        result = new PublicKey(key);
        pubKeyCache[key] = result;
    }

    return result;
};

async function findMetadataAddress(mint) {
    const pubKey = toPublicKey(mint);
    const programKey = toPublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

    const seeds = [
        Buffer.from('metadata'),
        programKey.toBuffer(),
        pubKey.toBuffer(),
    ]

    const cacheKey = 'pda-' + seeds.reduce((agg, item) => agg + item.toString('hex'), '') + pubKey.toString();

    let result = addressCache[cacheKey];

    if ( result == null ) {
        result = await PublicKey.findProgramAddress(seeds, programKey);
        result = result[0].toBase58();
        addressCache[cacheKey] = result;
    }

    return result;
};

async function getTokenAccounts(mint) {
    const response = await client.call(
        'getTokenLargestAccounts', [mint]
    );
    return response.result.value;
}

async function getAccountInfo(address) {
    const response = await client.call(
        'getAccountInfo', [
            address,
            { encoding: 'jsonParsed' },
        ]
    );
    return response.result.value.data.parsed.info;
}

export async function getNFTList(owner) {
    const response = await client.call(
        'getTokenAccountsByOwner', [
            owner,
            { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
            { encoding: 'jsonParsed' },
        ]
    );

    const tokenList = response.result.value;
    const nfts = [];

    for ( const token of tokenList ) {
        const data = token.account.data;

        if ( data.program != 'spl-token' ) {
            continue;
        }

        const info = data.parsed.info;
        const amount = info.tokenAmount;

        if ( amount.amount == 1 && amount.decimals == 0 ) {
            nfts.push({ pubkey: token.pubkey, mint: info.mint });
        }
    }

    return nfts;
}

export async function getNFTMetadata(nft) {
    const response = await client.call(
        'getAccountInfo', [
            await findMetadataAddress(nft.mint),
            { encoding: 'base64' },
        ]
    );

    const base64String = response.result.value.data[0];
    const metadata = parseMetadata(base64String);

    return metadata.data;
}

export async function getNFTOwner(nft) {
    const accounts = await getTokenAccounts(nft.mint);
    const currentAccount = accounts.find(account => account.amount == 1);

    if ( currentAccount == null ) {
        return null;
    }

    return await getAccountInfo(currentAccount.address).then(info => info.owner);
}

export async function getCandyMachineAddress(mint) {
    const response = await client.call(
        'getAccountInfo', [
            await findMetadataAddress(mint),
            { encoding: 'base64', dataSlice: { offset: 326, length: 32 } },
        ]
    );

    const data = response.result.value.data[0];
    return Buffer.from(data, 'base64');
}

export function parseMetadata(base64String) {
    const metadata = borsh.deserializeUnchecked(METADATA_SCHEMA, Metadata, Buffer.from(base64String, 'base64'));

    const data = metadata.data;
    data.name = data.name.replace(/\x00/g, '');
    data.symbol = data.symbol.replace(/\x00/g, '');
    data.uri = data.uri.replace(/\x00/g, '');

    return metadata;
}

export async function getCandyMachineMintMetadataList(candyMachineAddress) {
    const response = await client.call(
        'getProgramAccounts', [
            'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
            {
                encoding: 'base64',
                filters: [{ memcmp: { offset: 326, bytes: candyMachineAddress }}]
            }
        ]
    );
    return response.result.map(res => parseMetadata(res.account.data[0]));
}
