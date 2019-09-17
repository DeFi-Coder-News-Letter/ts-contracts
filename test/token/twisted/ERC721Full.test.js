const { BN, constants, expectEvent, expectRevert } = require('openzeppelin-test-helpers');
const { ZERO_ADDRESS } = constants;

const { shouldBehaveLikeERC721 } = require('./ERC721.behavior');
const { shouldSupportInterfaces } = require('../SupportsInterface.behavior');

const should = require('chai').should();

const TwistedToken = artifacts.require('TwistedToken');
const TwistedAccessControls = artifacts.require('TwistedAccessControls');

contract('ERC721 Full Test Suite for TwistedToken', function ([
                                     creator,
                                     auction,
                                     anotherAuction,
                                     ...accounts
                                 ]) {
    const name = 'Twisted';
    const symbol = 'TWIST';
    const firstTokenId = new BN(1);
    const secondTokenId = new BN(2);
    const thirdTokenId = new BN(3);
    const nonExistentTokenId = new BN(999);

    const baseURI = "ipfs/";
    const randIPFSHash = "QmRLHatjFTvm3i4ZtZU8KTGsBTsj3bLHLcL8FbdkNobUzm";
    const tokenNotFoundRevertReason = 'Token not found for ID';

    const minter = auction;

    const [
        owner,
        newOwner,
        another,
    ] = accounts;

    beforeEach(async function () {
        this.accessControls = await TwistedAccessControls.new({ from: creator });
        await this.accessControls.addWhitelisted(minter, { from: creator });
        (await this.accessControls.isWhitelisted(creator)).should.be.true;
        (await this.accessControls.isWhitelisted(minter)).should.be.true;

        this.token = await TwistedToken.new(baseURI, this.accessControls.address, { from: creator });
    });

    describe('like a full ERC721', function () {
        beforeEach(async function () {
            await this.token.createTwisted(0, 1, randIPFSHash, owner, { from: minter });
            await this.token.createTwisted(1, 2, randIPFSHash, owner, { from: minter });
        });

        describe('mint', function () {
            it('reverts with a null destination address', async function () {
                await expectRevert.unspecified(this.token.createTwisted(0, 0, randIPFSHash, ZERO_ADDRESS, { from: creator }));
            });

            context('with minted token', async function () {
                beforeEach(async function () {
                    ({ logs: this.logs } = await this.token.createTwisted(2, 3, randIPFSHash, newOwner, { from: minter }));
                });

                it('emits a Transfer and TwistMinted event', function () {
                    expectEvent.inLogs(this.logs, 'Transfer', {
                        from: ZERO_ADDRESS,
                        to: newOwner,
                        tokenId: thirdTokenId
                    });

                    expectEvent.inLogs(this.logs, 'TwistMinted', {
                        _recipient: newOwner,
                        _tokenId: thirdTokenId
                    });
                });

                it('adjusts owner tokens by index', async function () {
                    (await this.token.tokenOfOwnerByIndex(newOwner, 0)).should.be.bignumber.equal(thirdTokenId);
                });

                it('adjusts all tokens list', async function () {
                    (await this.token.tokenByIndex(2)).should.be.bignumber.equal(thirdTokenId);
                });
            });
        });

        describe('metadata', function () {
            const expectedUri = `${baseURI}${randIPFSHash}`;

            it('has a name', async function () {
                (await this.token.name()).should.be.equal(name);
            });

            it('has a symbol', async function () {
                (await this.token.symbol()).should.be.equal(symbol);
            });

            it('returns token uri', async function () {
                (await this.token.tokenURI(firstTokenId)).should.be.equal(expectedUri);
            });

            it('returns the TwistedToken\'s attributes', async function () {
                const {
                    _round,
                    _parameter,
                    _ipfsUrl
                } = await this.token.attributes(secondTokenId);

                _round.should.be.bignumber.equal(new BN('1'));
                _parameter.should.be.bignumber.equal(new BN('2'));
                _ipfsUrl.should.be.equal(expectedUri);
            });

            it('returns a token uri using updated base uri', async function () {
                const newBaseUri = 'super.ipfs/';
                const newExpectedUri = `${newBaseUri}${randIPFSHash}`;
                (await this.token.updateTokenBaseURI(newBaseUri, {from: creator}));
                (await this.token.tokenURI(firstTokenId)).should.be.equal(newExpectedUri);
            });

            it('returns a token uri using updated ipfs hash', async function () {
                const newIpfsHash = 'QmRLHatjFTvm3i4ZtZU8KTGsBTsj3bLHLcL8FbdkNobUzb';
                const newExpectedUri = `${baseURI}${newIpfsHash}`;
                (await this.token.updateIpfsHash(secondTokenId, newIpfsHash));
                (await this.token.tokenURI(secondTokenId)).should.be.equal(newExpectedUri);
            });

            it('reverts when fetching atrributes of a non-existent token', async function () {
                await expectRevert(
                    this.token.attributes(nonExistentTokenId),
                    tokenNotFoundRevertReason
                );
            });

            it('reverts when trying to update the base token URI from an unauthorised address', async function() {
                await expectRevert.unspecified(this.token.updateTokenBaseURI('', { from: another}));
            });

            it('reverts when updating base uri to a blank string', async function () {
                await expectRevert(
                    this.token.updateTokenBaseURI(''),
                    'Base URI invalid'
                );
            });

            it('reverts when trying to update the IPFS hash of a token from an unauthorised address', async function() {
                await expectRevert.unspecified(this.token.updateIpfsHash(firstTokenId, '', { from: another}));
            });

            it('reverts when updating the IPFS hash of a token to a blank string', async function () {
                await expectRevert(
                    this.token.updateIpfsHash(firstTokenId, ''),
                    'New IPFS hash invalid'
                );
            });

            it('reverts when updating the IPFS hash of a token that doesn\'t exist', async function () {
                await expectRevert(
                    this.token.updateIpfsHash(nonExistentTokenId, ''),
                    tokenNotFoundRevertReason
                );
            });

            it('reverts when querying metadata for non existent token id', async function () {
                await expectRevert.unspecified(this.token.tokenURI(nonExistentTokenId));
            });
        });

        describe('tokensOfOwner', function () {
            it('returns total tokens of owner', async function () {
                const tokenIds = await this.token.tokensOfOwner(owner);
                tokenIds.length.should.equal(2);
                tokenIds[0].should.be.bignumber.equal(firstTokenId);
                tokenIds[1].should.be.bignumber.equal(secondTokenId);
            });
        });

        describe('totalSupply', function () {
            it('returns total token supply', async function () {
                (await this.token.totalSupply()).should.be.bignumber.equal('2');
            });
        });

        describe('tokenOfOwnerByIndex', function () {
            describe('when the given index is lower than the amount of tokens owned by the given address', function () {
                it('returns the token ID placed at the given index', async function () {
                    (await this.token.tokenOfOwnerByIndex(owner, 0)).should.be.bignumber.equal(firstTokenId);
                });
            });

            describe('when the index is greater than or equal to the total tokens owned by the given address', function () {
                it('reverts', async function () {
                    await expectRevert.unspecified(this.token.tokenOfOwnerByIndex(owner, 2));
                });
            });

            describe('when the given address does not own any token', function () {
                it('reverts', async function () {
                    await expectRevert.unspecified(this.token.tokenOfOwnerByIndex(another, 0));
                });
            });

            describe('after transferring all tokens to another user', function () {
                beforeEach(async function () {
                    await this.token.transferFrom(owner, another, firstTokenId, { from: owner });
                    await this.token.transferFrom(owner, another, secondTokenId, { from: owner });
                });

                it('returns correct token IDs for target', async function () {
                    (await this.token.balanceOf(another)).should.be.bignumber.equal('2');
                    const tokensListed = await Promise.all(
                        [0, 1].map(i => this.token.tokenOfOwnerByIndex(another, i))
                    );
                    tokensListed.map(t => t.toNumber()).should.have.members([firstTokenId.toNumber(), secondTokenId.toNumber()]);
                });

                it('returns empty collection for original owner', async function () {
                    (await this.token.balanceOf(owner)).should.be.bignumber.equal('0');
                    await expectRevert.unspecified(this.token.tokenOfOwnerByIndex(owner, 0));
                });
            });
        });

        describe('tokenByIndex', function () {
            it('should return all tokens', async function () {
                const tokensListed = await Promise.all(
                    [0, 1].map(i => this.token.tokenByIndex(i))
                );
                tokensListed.map(t => t.toNumber()).should.have.members([firstTokenId.toNumber(), secondTokenId.toNumber()]);
            });

            it('should revert if index is greater than supply', async function () {
                await expectRevert.unspecified(this.token.tokenByIndex(2));
            });
        });
    });

    shouldBehaveLikeERC721(creator, minter, accounts);

    shouldSupportInterfaces([
        'ERC165',
        'ERC721',
        'ERC721Enumerable',
        'ERC721Metadata',
    ]);
});